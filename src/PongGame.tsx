import { useEffect, useRef, useState, useCallback } from "react";
import { Application, Graphics, Sprite, Texture, RenderTexture } from "pixi.js";
import pako from "pako";
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Stack,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import VideocamIcon from "@mui/icons-material/Videocam";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";

// Game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PADDLE_WIDTH = 60;
const PADDLE_HEIGHT = 80;
const BALL_SIZE = 15;
const BALL_SPEED = 8;
const PADDLE_SPEED = 8;

// WebRTC configuration
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Encoding utilities
function encodeForURL(data: object): string {
  const jsonStr = JSON.stringify(data);
  const compressed = pako.gzip(jsonStr);
  const base64 = btoa(String.fromCharCode(...compressed));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeFromURL(encoded: string): object {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const decompressed = pako.ungzip(bytes, { to: "string" });
  return JSON.parse(decompressed);
}

interface GameState {
  ball: { x: number; y: number; vx: number; vy: number };
  paddle1Y: number;
  paddle2Y: number;
  score1: number;
  score2: number;
}

export default function PongGame() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<Application | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Game objects refs
  const paddle1Ref = useRef<Sprite | null>(null);
  const paddle2Ref = useRef<Sprite | null>(null);
  const ballRef = useRef<Graphics | null>(null);

  const [role, setRole] = useState<"none" | "host" | "guest">("none");
  const roleRef = useRef<"none" | "host" | "guest">("none");
  const [status, setStatus] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [answerInput, setAnswerInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");

  // Webcam states
  const [webcamDialogOpen, setWebcamDialogOpen] = useState(false);
  const [faceCapturing, setFaceCapturing] = useState(false);
  const [hostFaceImage, setHostFaceImage] = useState<string | null>(null);
  const [guestFaceImage, setGuestFaceImage] = useState<string | null>(null);
  const hostFaceImageRef = useRef<string | null>(null);
  const guestFaceImageRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);

  // Game state
  const gameStateRef = useRef<GameState>({
    ball: {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      vx: BALL_SPEED,
      vy: BALL_SPEED / 2,
    },
    paddle1Y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    paddle2Y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    score1: 0,
    score2: 0,
  });

  const keysRef = useRef<Set<string>>(new Set());
  const gameLoopRef = useRef<number | null>(null);

  // Show snackbar notification
  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarOpen(true);
  };

  // Create face texture from image data
  const createFaceTexture = useCallback(
    async (imageData: string): Promise<Texture> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const texture = Texture.from(img);
          resolve(texture);
        };
        img.src = imageData;
      });
    },
    []
  );

  // Update paddle texture
  const updatePaddleTexture = useCallback(
    async (paddle: Sprite, imageData: string) => {
      const texture = await createFaceTexture(imageData);
      paddle.texture = texture;
      paddle.width = PADDLE_WIDTH;
      paddle.height = PADDLE_HEIGHT;
    },
    [createFaceTexture]
  );

  // Initialize PixiJS
  const initPixi = useCallback(async () => {
    if (!gameContainerRef.current || pixiAppRef.current) return;

    const app = new Application();
    await app.init({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: 0x1a1a2e,
      antialias: true,
    });

    gameContainerRef.current.appendChild(app.canvas);
    pixiAppRef.current = app;

    // Create paddle textures (default rectangles)
    const createDefaultPaddleTexture = (): Texture => {
      const graphics = new Graphics();
      graphics.rect(0, 0, PADDLE_WIDTH, PADDLE_HEIGHT);
      graphics.fill(0xffffff);
      const renderTexture = RenderTexture.create({
        width: PADDLE_WIDTH,
        height: PADDLE_HEIGHT,
      });
      app.renderer.render({ container: graphics, target: renderTexture });
      return renderTexture;
    };

    // Create paddle 1 (left)
    const paddle1 = new Sprite(createDefaultPaddleTexture());
    paddle1.x = 20;
    paddle1.y = gameStateRef.current.paddle1Y;
    app.stage.addChild(paddle1);
    paddle1Ref.current = paddle1;

    // Create paddle 2 (right)
    const paddle2 = new Sprite(createDefaultPaddleTexture());
    paddle2.x = CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    paddle2.y = gameStateRef.current.paddle2Y;
    app.stage.addChild(paddle2);
    paddle2Ref.current = paddle2;

    // Create ball
    const ball = new Graphics();
    ball.circle(0, 0, BALL_SIZE / 2);
    ball.fill(0xffffff);
    ball.x = gameStateRef.current.ball.x;
    ball.y = gameStateRef.current.ball.y;
    app.stage.addChild(ball);
    ballRef.current = ball;

    // Create center line
    const centerLine = new Graphics();
    for (let y = 0; y < CANVAS_HEIGHT; y += 30) {
      centerLine.rect(CANVAS_WIDTH / 2 - 2, y, 4, 15);
      centerLine.fill(0x444444);
    }
    app.stage.addChild(centerLine);
  }, []);

  // Webcam capture
  const openWebcamDialog = async () => {
    setWebcamDialogOpen(true);
    setFaceCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      webcamStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setFaceCapturing(false);
    } catch (error) {
      console.error("Webcam error:", error);
      setStatus("Nepodarilo sa pristúpiť k webkamere");
      setFaceCapturing(false);
      setWebcamDialogOpen(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = PADDLE_WIDTH * 2;
    canvas.height = PADDLE_HEIGHT * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw video frame to canvas (cropped to center square)
    const video = videoRef.current;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;

    ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL("image/png");

    if (role === "host" || role === "none") {
      setHostFaceImage(imageData);
      hostFaceImageRef.current = imageData;
      // Send to guest if connected
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(
          JSON.stringify({ type: "hostFace", data: imageData })
        );
      }
      // Update paddle texture
      if (paddle1Ref.current) {
        updatePaddleTexture(paddle1Ref.current, imageData);
      }
    } else {
      setGuestFaceImage(imageData);
      guestFaceImageRef.current = imageData;
      // Send to host if connected
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(
          JSON.stringify({ type: "guestFace", data: imageData })
        );
      }
      // Update paddle texture
      if (paddle2Ref.current) {
        updatePaddleTexture(paddle2Ref.current, imageData);
      }
    }

    closeWebcamDialog();
    showSnackbar("Fotka bola zachytená!");
  };

  const closeWebcamDialog = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
    setWebcamDialogOpen(false);
  };

  // Setup data channel - uses refs to avoid stale closures
  const setupDataChannel = useCallback(
    (channel: RTCDataChannel) => {
      dataChannelRef.current = channel;

      channel.onopen = () => {
        setConnected(true);
        setStatus("Pripojené! Hra začína...");
        // Send face image to peer using refs for current values
        if (roleRef.current === "host" && hostFaceImageRef.current) {
          channel.send(
            JSON.stringify({ type: "hostFace", data: hostFaceImageRef.current })
          );
        } else if (roleRef.current === "guest" && guestFaceImageRef.current) {
          channel.send(
            JSON.stringify({
              type: "guestFace",
              data: guestFaceImageRef.current,
            })
          );
        }
      };

      channel.onclose = () => {
        setConnected(false);
        setStatus("Spojenie ukončené");
      };

      channel.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "gameState" && roleRef.current === "guest") {
          gameStateRef.current = message.state;
        } else if (message.type === "input" && roleRef.current === "host") {
          const paddleY = gameStateRef.current.paddle2Y;
          if (message.direction === "up") {
            gameStateRef.current.paddle2Y = Math.max(0, paddleY - PADDLE_SPEED);
          } else if (message.direction === "down") {
            gameStateRef.current.paddle2Y = Math.min(
              CANVAS_HEIGHT - PADDLE_HEIGHT,
              paddleY + PADDLE_SPEED
            );
          }
        } else if (message.type === "hostFace") {
          setHostFaceImage(message.data);
          hostFaceImageRef.current = message.data;
          if (paddle1Ref.current) {
            await updatePaddleTexture(paddle1Ref.current, message.data);
          }
        } else if (message.type === "guestFace") {
          setGuestFaceImage(message.data);
          guestFaceImageRef.current = message.data;
          if (paddle2Ref.current) {
            await updatePaddleTexture(paddle2Ref.current, message.data);
          }
        }
      };
    },
    [updatePaddleTexture]
  );

  // Wait for ICE gathering
  const waitForICE = (pc: RTCPeerConnection): Promise<void> => {
    return new Promise((resolve) => {
      let candidateCount = 0;
      const timeout = setTimeout(() => {
        console.log(
          "ICE gathering timeout, proceeding with",
          candidateCount,
          "candidates"
        );
        resolve();
      }, 3000);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidateCount++;
        } else {
          clearTimeout(timeout);
          console.log(
            "ICE gathering complete with",
            candidateCount,
            "candidates"
          );
          resolve();
        }
      };

      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  };

  // Create game (host)
  const createGame = async () => {
    setRole("host");
    roleRef.current = "host";
    setStatus("Vytváram hru...");

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;

    const channel = pc.createDataChannel("game");
    setupDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    setStatus("Čakám na ICE kandidátov...");
    await waitForICE(pc);

    const offerData = {
      sdp: pc.localDescription?.sdp,
      type: pc.localDescription?.type,
    };

    const encoded = encodeForURL(offerData);
    const link = `${window.location.origin}${window.location.pathname}?d=${encoded}`;
    setInviteLink(link);
    setStatus("Invite link vygenerovaný! Pošli ho kamarátovi.");
  };

  // Handle incoming offer (guest)
  const handleIncomingOffer = useCallback(
    async (offerData: RTCSessionDescriptionInit) => {
      setRole("guest");
      roleRef.current = "guest";
      setStatus("Aplikujem ponuku od hostiteľa...");

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      pc.ondatachannel = (event) => {
        setupDataChannel(event.channel);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offerData));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setStatus("Čakám na ICE kandidátov...");
      await waitForICE(pc);

      const answerData = {
        sdp: pc.localDescription?.sdp,
        type: pc.localDescription?.type,
      };

      const encoded = encodeForURL(answerData);
      setAnswerCode(encoded);
      setStatus("Skopíruj kód odpovede a pošli ho hostiteľovi.");
    },
    [setupDataChannel]
  );

  // Process answer (host)
  const processAnswer = async () => {
    if (!peerConnectionRef.current || !answerInput.trim()) return;

    setStatus("Spracovávam odpoveď...");

    try {
      let encoded = answerInput.trim();
      // Handle full URL or just code
      if (encoded.includes("?d=")) {
        encoded = encoded.split("?d=")[1];
      }

      const answerData = decodeFromURL(encoded) as RTCSessionDescriptionInit;
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(answerData)
      );
      setStatus("Odpoveď prijatá, pripájam sa...");
    } catch (error) {
      console.error("Error processing answer:", error);
      setStatus("Chyba pri spracovaní odpovede");
    }
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSnackbar("Skopírované do schránky!");
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  // Game loop - uses roleRef to avoid stale closures
  const updateGame = useCallback(() => {
    const state = gameStateRef.current;
    const currentRole = roleRef.current;

    if (currentRole === "host") {
      // Update paddle 1 (host)
      if (keysRef.current.has("ArrowUp") || keysRef.current.has("w")) {
        state.paddle1Y = Math.max(0, state.paddle1Y - PADDLE_SPEED);
      }
      if (keysRef.current.has("ArrowDown") || keysRef.current.has("s")) {
        state.paddle1Y = Math.min(
          CANVAS_HEIGHT - PADDLE_HEIGHT,
          state.paddle1Y + PADDLE_SPEED
        );
      }

      // Update ball
      state.ball.x += state.ball.vx;
      state.ball.y += state.ball.vy;

      // Ball collision with top/bottom
      if (
        state.ball.y <= BALL_SIZE / 2 ||
        state.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2
      ) {
        state.ball.vy *= -1;
      }

      // Ball collision with paddles
      // Paddle 1
      if (
        state.ball.x - BALL_SIZE / 2 <= 20 + PADDLE_WIDTH &&
        state.ball.x - BALL_SIZE / 2 >= 20 &&
        state.ball.y >= state.paddle1Y &&
        state.ball.y <= state.paddle1Y + PADDLE_HEIGHT &&
        state.ball.vx < 0
      ) {
        state.ball.vx *= -1;
        state.ball.x = 20 + PADDLE_WIDTH + BALL_SIZE / 2;
      }

      // Paddle 2
      if (
        state.ball.x + BALL_SIZE / 2 >= CANVAS_WIDTH - 20 - PADDLE_WIDTH &&
        state.ball.x + BALL_SIZE / 2 <= CANVAS_WIDTH - 20 &&
        state.ball.y >= state.paddle2Y &&
        state.ball.y <= state.paddle2Y + PADDLE_HEIGHT &&
        state.ball.vx > 0
      ) {
        state.ball.vx *= -1;
        state.ball.x = CANVAS_WIDTH - 20 - PADDLE_WIDTH - BALL_SIZE / 2;
      }

      // Score
      if (state.ball.x < 0) {
        state.score2++;
        state.ball = {
          x: CANVAS_WIDTH / 2,
          y: CANVAS_HEIGHT / 2,
          vx: BALL_SPEED,
          vy: BALL_SPEED / 2,
        };
      }
      if (state.ball.x > CANVAS_WIDTH) {
        state.score1++;
        state.ball = {
          x: CANVAS_WIDTH / 2,
          y: CANVAS_HEIGHT / 2,
          vx: -BALL_SPEED,
          vy: BALL_SPEED / 2,
        };
      }

      // Send state to guest
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(
          JSON.stringify({ type: "gameState", state })
        );
      }
    } else if (currentRole === "guest") {
      // Send input to host
      if (dataChannelRef.current?.readyState === "open") {
        if (keysRef.current.has("ArrowUp") || keysRef.current.has("w")) {
          dataChannelRef.current.send(
            JSON.stringify({ type: "input", direction: "up" })
          );
        }
        if (keysRef.current.has("ArrowDown") || keysRef.current.has("s")) {
          dataChannelRef.current.send(
            JSON.stringify({ type: "input", direction: "down" })
          );
        }
      }
    }

    // Render
    if (paddle1Ref.current) {
      paddle1Ref.current.y = state.paddle1Y;
    }
    if (paddle2Ref.current) {
      paddle2Ref.current.y = state.paddle2Y;
    }
    if (ballRef.current) {
      ballRef.current.x = state.ball.x;
      ballRef.current.y = state.ball.y;
    }

    gameLoopRef.current = requestAnimationFrame(updateGame);
  }, []);

  // Start game loop
  useEffect(() => {
    if (connected) {
      gameLoopRef.current = requestAnimationFrame(updateGame);
    }

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [connected, updateGame]);

  // Initialize PixiJS on mount
  useEffect(() => {
    initPixi();

    return () => {
      if (pixiAppRef.current) {
        pixiAppRef.current.destroy(true);
        pixiAppRef.current = null;
      }
    };
  }, [initPixi]);

  // Check URL for offer
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const data = params.get("d");
    if (data && role === "none") {
      try {
        const offerData = decodeFromURL(data) as RTCSessionDescriptionInit;
        handleIncomingOffer(offerData);
      } catch (error) {
        console.error("Error decoding offer:", error);
        setStatus("Neplatný invite link");
      }
    }
  }, [role, handleIncomingOffer]);

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "w", "s"].includes(e.key)) {
        e.preventDefault();
        keysRef.current.add(e.key);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#0f0f23",
        color: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 4,
      }}
    >
      <Typography
        variant="h3"
        component="h1"
        gutterBottom
        sx={{ color: "#00d9ff" }}
      >
        <SportsEsportsIcon
          sx={{ fontSize: 40, mr: 1, verticalAlign: "middle" }}
        />
        WebRTC Pong
      </Typography>

      {/* Game Canvas */}
      <Paper
        elevation={8}
        sx={{
          mb: 3,
          borderRadius: 2,
          overflow: "hidden",
          border: "2px solid #00d9ff",
        }}
      >
        <Box ref={gameContainerRef} />
      </Paper>

      {/* Score Display */}
      {connected && (
        <Typography variant="h4" sx={{ mb: 2, fontFamily: "monospace" }}>
          {gameStateRef.current.score1} : {gameStateRef.current.score2}
        </Typography>
      )}

      {/* Status */}
      {status && (
        <Alert severity="info" sx={{ mb: 2, maxWidth: 600 }}>
          {status}
        </Alert>
      )}

      {/* Controls */}
      <Paper sx={{ p: 3, bgcolor: "#1a1a3e", maxWidth: 600, width: "100%" }}>
        {role === "none" && (
          <Stack spacing={2}>
            <Typography variant="h6" textAlign="center">
              Začni novú hru
            </Typography>
            <Stack direction="row" spacing={2} justifyContent="center">
              <Button
                variant="contained"
                color="primary"
                onClick={createGame}
                startIcon={<SportsEsportsIcon />}
              >
                Vytvoriť hru (Host)
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                onClick={openWebcamDialog}
                startIcon={<VideocamIcon />}
              >
                Odfotiť tvár
              </Button>
            </Stack>
            {hostFaceImage && (
              <Box textAlign="center">
                <Typography variant="body2" color="success.main">
                  ✓ Tvár zachytená
                </Typography>
              </Box>
            )}
          </Stack>
        )}

        {role === "host" && !connected && (
          <Stack spacing={2}>
            {inviteLink && (
              <>
                <Typography variant="body1">
                  Pošli tento link kamarátovi:
                </Typography>
                <TextField
                  fullWidth
                  value={inviteLink}
                  InputProps={{
                    readOnly: true,
                    sx: {
                      bgcolor: "#0f0f23",
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                    },
                  }}
                />
                <Button
                  variant="contained"
                  onClick={() => copyToClipboard(inviteLink)}
                  startIcon={<ContentCopyIcon />}
                >
                  Kopírovať link
                </Button>

                <Typography variant="body1" sx={{ mt: 2 }}>
                  Vlož kód odpovede od kamaráta:
                </Typography>
                <TextField
                  fullWidth
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                  placeholder="Vlož kód odpovede..."
                  InputProps={{
                    sx: { bgcolor: "#0f0f23" },
                  }}
                />
                <Button
                  variant="contained"
                  color="success"
                  onClick={processAnswer}
                >
                  Pripojiť
                </Button>
              </>
            )}
            <Button
              variant="outlined"
              color="secondary"
              onClick={openWebcamDialog}
              startIcon={<VideocamIcon />}
            >
              Odfotiť tvár
            </Button>
          </Stack>
        )}

        {role === "guest" && !connected && (
          <Stack spacing={2}>
            {answerCode ? (
              <>
                <Typography variant="body1">
                  Pošli tento kód hostiteľovi:
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  value={answerCode}
                  InputProps={{
                    readOnly: true,
                    sx: {
                      bgcolor: "#0f0f23",
                      fontFamily: "monospace",
                      fontSize: "0.7rem",
                    },
                  }}
                />
                <Button
                  variant="contained"
                  onClick={() => copyToClipboard(answerCode)}
                  startIcon={<ContentCopyIcon />}
                >
                  Kopírovať kód
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  onClick={openWebcamDialog}
                  startIcon={<VideocamIcon />}
                >
                  Odfotiť tvár
                </Button>
                {guestFaceImage && (
                  <Box textAlign="center">
                    <Typography variant="body2" color="success.main">
                      ✓ Tvár zachytená
                    </Typography>
                  </Box>
                )}
              </>
            ) : (
              <Box textAlign="center">
                <CircularProgress />
                <Typography sx={{ mt: 2 }}>Generujem odpoveď...</Typography>
              </Box>
            )}
          </Stack>
        )}

        {connected && (
          <Stack spacing={2}>
            <Alert severity="success">
              Pripojené! Ovládaj pálku šípkami alebo W/S.
            </Alert>
            <Button
              variant="outlined"
              color="secondary"
              onClick={openWebcamDialog}
              startIcon={<VideocamIcon />}
            >
              Zmeniť tvár
            </Button>
          </Stack>
        )}
      </Paper>

      {/* Webcam Dialog */}
      <Dialog
        open={webcamDialogOpen}
        onClose={closeWebcamDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Zachyť svoju tvár</DialogTitle>
        <DialogContent>
          {faceCapturing ? (
            <Box textAlign="center" py={4}>
              <CircularProgress />
              <Typography sx={{ mt: 2 }}>Pristupujem k webkamere...</Typography>
            </Box>
          ) : (
            <Box textAlign="center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  maxWidth: 400,
                  borderRadius: 8,
                  transform: "scaleX(-1)",
                }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeWebcamDialog}>Zrušiť</Button>
          <Button
            variant="contained"
            onClick={capturePhoto}
            disabled={faceCapturing}
          >
            Odfotiť
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />

      {/* Instructions */}
      <Paper
        sx={{ p: 2, mt: 3, bgcolor: "#1a1a3e", maxWidth: 600, width: "100%" }}
      >
        <Typography variant="h6" gutterBottom>
          Ako hrať
        </Typography>
        <Typography variant="body2" component="div">
          <ol>
            <li>Hostiteľ klikne na "Vytvoriť hru" a pošle link kamarátovi</li>
            <li>Kamarát otvorí link a pošle vygenerovaný kód späť</li>
            <li>Hostiteľ vloží kód a klikne "Pripojiť"</li>
            <li>Ovládaj pálku šípkami ↑↓ alebo klávesmi W/S</li>
            <li>Môžeš si odfotiť tvár a tá bude tvojou pálkou!</li>
          </ol>
        </Typography>
      </Paper>
    </Box>
  );
}
