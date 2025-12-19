import { useCallback, useEffect, useRef, useState } from "react";
import { Application, Graphics, Sprite, Texture, RenderTexture } from "pixi.js";
import pako from "pako";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import VideocamIcon from "@mui/icons-material/Videocam";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import LogoutIcon from "@mui/icons-material/Logout";

type PongGameProps = {
  onExitToMenu?: () => void;
  onImmersiveChange?: (value: boolean) => void;
};

type GamePhase = "idle" | "lobby" | "countdown" | "playing";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 560;
const PADDLE_WIDTH = 60;
const PADDLE_HEIGHT = 88;
const BALL_SIZE = 16;
const DEFAULT_BALL_SPEED = 5;
const PADDLE_SPEED = 8;

const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

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

export default function PongGame({
  onExitToMenu,
  onImmersiveChange,
}: PongGameProps) {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<Application | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const paddle1Ref = useRef<Sprite | null>(null);
  const paddle2Ref = useRef<Sprite | null>(null);
  const ballRef = useRef<Graphics | null>(null);

  const [role, setRole] = useState<"none" | "host" | "guest">("none");
  const roleRef = useRef<"none" | "host" | "guest">("none");
  const [status, setStatus] = useState("Pripravené na vytvorenie hry");
  const [inviteLink, setInviteLink] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [answerInput, setAnswerInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [scores, setScores] = useState({ score1: 0, score2: 0 });
  const scoresRef = useRef(scores);
  const [gamePhase, setGamePhase] = useState<GamePhase>("idle");
  const gamePhaseRef = useRef<GamePhase>("idle");
  const [countdown, setCountdown] = useState(3);
  const countdownTimerRef = useRef<number | null>(null);
  const [ballSpeed, setBallSpeed] = useState(DEFAULT_BALL_SPEED);
  const ballSpeedRef = useRef(DEFAULT_BALL_SPEED);

  const keysRef = useRef<Set<string>>(new Set());
  const gameLoopRef = useRef<number | null>(null);

  const [webcamDialogOpen, setWebcamDialogOpen] = useState(false);
  const [faceCapturing, setFaceCapturing] = useState(false);
  const [hostFaceImage, setHostFaceImage] = useState<string | null>(null);
  const [guestFaceImage, setGuestFaceImage] = useState<string | null>(null);
  const hostFaceImageRef = useRef<string | null>(null);
  const guestFaceImageRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);

  const gameStateRef = useRef<GameState>({
    ball: {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      vx: DEFAULT_BALL_SPEED,
      vy: DEFAULT_BALL_SPEED / 2,
    },
    paddle1Y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    paddle2Y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    score1: 0,
    score2: 0,
  });

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarOpen(true);
  };

  const createFaceTexture = useCallback(
    async (imageData: string): Promise<Texture> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(Texture.from(img));
        img.src = imageData;
      });
    },
    []
  );

  const updatePaddleTexture = useCallback(
    async (paddle: Sprite, imageData: string) => {
      const texture = await createFaceTexture(imageData);
      paddle.texture = texture;
      paddle.width = PADDLE_WIDTH;
      paddle.height = PADDLE_HEIGHT;
    },
    [createFaceTexture]
  );

  const resetBall = (direction: 1 | -1 = 1) => {
    gameStateRef.current.ball = {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2,
      vx: direction * ballSpeedRef.current,
      vy: (ballSpeedRef.current / 2) * (Math.random() > 0.5 ? 1 : -1),
    };
  };

  const resetState = () => {
    gameStateRef.current = {
      ball: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        vx: ballSpeedRef.current,
        vy: ballSpeedRef.current / 2,
      },
      paddle1Y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      paddle2Y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      score1: 0,
      score2: 0,
    };
    setScores({ score1: 0, score2: 0 });
    scoresRef.current = { score1: 0, score2: 0 };
    setCountdown(3);
    setStatus("Pripravené na vytvorenie hry");
  };

  const initPixi = useCallback(async () => {
    if (!gameContainerRef.current || pixiAppRef.current) return;

    const app = new Application();
    await app.init({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: 0x0a0f1c,
      antialias: true,
    });

    gameContainerRef.current.innerHTML = "";
    gameContainerRef.current.appendChild(app.canvas);
    pixiAppRef.current = app;

    const createDefaultPaddleTexture = (): Texture => {
      const graphics = new Graphics();
      graphics.roundRect(0, 0, PADDLE_WIDTH, PADDLE_HEIGHT, 12);
      graphics.fill(0xffffff);
      const renderTexture = RenderTexture.create({
        width: PADDLE_WIDTH,
        height: PADDLE_HEIGHT,
      });
      app.renderer.render({ container: graphics, target: renderTexture });
      return renderTexture;
    };

    const paddle1 = new Sprite(createDefaultPaddleTexture());
    paddle1.x = 20;
    paddle1.y = gameStateRef.current.paddle1Y;
    app.stage.addChild(paddle1);
    paddle1Ref.current = paddle1;

    const paddle2 = new Sprite(createDefaultPaddleTexture());
    paddle2.x = CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    paddle2.y = gameStateRef.current.paddle2Y;
    app.stage.addChild(paddle2);
    paddle2Ref.current = paddle2;

    const ball = new Graphics();
    ball.circle(0, 0, BALL_SIZE / 2);
    ball.fill(0xffffff);
    ball.x = gameStateRef.current.ball.x;
    ball.y = gameStateRef.current.ball.y;
    app.stage.addChild(ball);
    ballRef.current = ball;

    const centerLine = new Graphics();
    for (let y = 0; y < CANVAS_HEIGHT; y += 28) {
      centerLine.rect(CANVAS_WIDTH / 2 - 2, y, 4, 12);
      centerLine.fill(0x1f2d3d);
    }
    app.stage.addChild(centerLine);
  }, []);

  const openWebcamDialog = async () => {
    setWebcamDialogOpen(true);
    setFaceCapturing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      webcamStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
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

    const video = videoRef.current;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL("image/png");

    if (roleRef.current === "host" || roleRef.current === "none") {
      setHostFaceImage(imageData);
      hostFaceImageRef.current = imageData;
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(
          JSON.stringify({ type: "hostFace", data: imageData })
        );
      }
      if (paddle1Ref.current)
        updatePaddleTexture(paddle1Ref.current, imageData);
    } else {
      setGuestFaceImage(imageData);
      guestFaceImageRef.current = imageData;
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(
          JSON.stringify({ type: "guestFace", data: imageData })
        );
      }
      if (paddle2Ref.current)
        updatePaddleTexture(paddle2Ref.current, imageData);
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

  const broadcastSettings = (speed: number) => {
    if (dataChannelRef.current?.readyState === "open") {
      dataChannelRef.current.send(
        JSON.stringify({ type: "settings", ballSpeed: speed })
      );
    }
  };

  const startCountdown = useCallback((startFrom = 3) => {
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
    }
    setCountdown(startFrom);
    setGamePhase("countdown");
    gamePhaseRef.current = "countdown";

    const tick = (value: number) => {
      setCountdown(value);
      if (
        roleRef.current === "host" &&
        dataChannelRef.current?.readyState === "open"
      ) {
        dataChannelRef.current.send(
          JSON.stringify({
            type: "phase",
            phase: "countdown",
            countdown: value,
          })
        );
      }
      if (value <= 0) {
        setGamePhase("playing");
        gamePhaseRef.current = "playing";
        if (
          roleRef.current === "host" &&
          dataChannelRef.current?.readyState === "open"
        ) {
          dataChannelRef.current.send(
            JSON.stringify({ type: "phase", phase: "playing" })
          );
        }
        return;
      }
      countdownTimerRef.current = window.setTimeout(
        () => tick(value - 1),
        1000
      );
    };

    tick(startFrom);
  }, []);

  const setupDataChannel = useCallback(
    (channel: RTCDataChannel) => {
      dataChannelRef.current = channel;

      channel.onopen = () => {
        setConnected(true);
        setStatus("Pripojené!");
        setGamePhase("lobby");
        gamePhaseRef.current = "lobby";
        if (roleRef.current === "host") {
          if (hostFaceImageRef.current) {
            channel.send(
              JSON.stringify({
                type: "hostFace",
                data: hostFaceImageRef.current,
              })
            );
          }
          channel.send(
            JSON.stringify({
              type: "settings",
              ballSpeed: ballSpeedRef.current,
            })
          );
          startCountdown();
        } else if (guestFaceImageRef.current) {
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
        setGamePhase("idle");
        gamePhaseRef.current = "idle";
      };

      channel.onmessage = async (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "gameState" && roleRef.current === "guest") {
          gameStateRef.current = message.state;
          const { score1, score2 } = message.state;
          if (
            score1 !== scoresRef.current.score1 ||
            score2 !== scoresRef.current.score2
          ) {
            scoresRef.current = { score1, score2 };
            setScores({ score1, score2 });
          }
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
          if (paddle1Ref.current)
            await updatePaddleTexture(paddle1Ref.current, message.data);
        } else if (message.type === "guestFace") {
          setGuestFaceImage(message.data);
          guestFaceImageRef.current = message.data;
          if (paddle2Ref.current)
            await updatePaddleTexture(paddle2Ref.current, message.data);
        } else if (message.type === "phase") {
          if (message.phase === "countdown") {
            setGamePhase("countdown");
            gamePhaseRef.current = "countdown";
            setCountdown(message.countdown ?? 3);
          } else if (message.phase === "playing") {
            setGamePhase("playing");
            gamePhaseRef.current = "playing";
          }
        } else if (
          message.type === "settings" &&
          typeof message.ballSpeed === "number"
        ) {
          setBallSpeed(message.ballSpeed);
          ballSpeedRef.current = message.ballSpeed;
        }
      };
    },
    [startCountdown, updatePaddleTexture]
  );

  const waitForICE = (pc: RTCPeerConnection): Promise<void> => {
    return new Promise((resolve) => {
      let candidateCount = 0;
      const timeout = setTimeout(() => resolve(), 3000);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidateCount++;
        } else {
          clearTimeout(timeout);
          resolve();
        }
      };

      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  };

  const createGame = async () => {
    setRole("host");
    roleRef.current = "host";
    setGamePhase("lobby");
    gamePhaseRef.current = "lobby";
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

  const handleIncomingOffer = useCallback(
    async (offerData: RTCSessionDescriptionInit) => {
      setRole("guest");
      roleRef.current = "guest";
      setGamePhase("lobby");
      gamePhaseRef.current = "lobby";
      setStatus("Aplikujem ponuku od hostiteľa...");

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      pc.ondatachannel = (event) => setupDataChannel(event.channel);

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

  const processAnswer = async () => {
    if (!peerConnectionRef.current || !answerInput.trim()) return;
    setStatus("Spracovávam odpoveď...");

    try {
      let encoded = answerInput.trim();
      if (encoded.includes("?d=")) encoded = encoded.split("?d=")[1];

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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSnackbar("Skopírované do schránky!");
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const updateGame = useCallback(() => {
    const state = gameStateRef.current;
    const currentRole = roleRef.current;

    if (currentRole === "host") {
      if (keysRef.current.has("ArrowUp") || keysRef.current.has("w")) {
        state.paddle1Y = Math.max(0, state.paddle1Y - PADDLE_SPEED);
      }
      if (keysRef.current.has("ArrowDown") || keysRef.current.has("s")) {
        state.paddle1Y = Math.min(
          CANVAS_HEIGHT - PADDLE_HEIGHT,
          state.paddle1Y + PADDLE_SPEED
        );
      }

      if (gamePhaseRef.current === "playing") {
        state.ball.x += state.ball.vx;
        state.ball.y += state.ball.vy;

        if (
          state.ball.y <= BALL_SIZE / 2 ||
          state.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2
        ) {
          state.ball.vy *= -1;
        }

        if (
          state.ball.x - BALL_SIZE / 2 <= 20 + PADDLE_WIDTH &&
          state.ball.x - BALL_SIZE / 2 >= 20 &&
          state.ball.y >= state.paddle1Y &&
          state.ball.y <= state.paddle1Y + PADDLE_HEIGHT &&
          state.ball.vx < 0
        ) {
          state.ball.vx = Math.abs(state.ball.vx);
          state.ball.x = 20 + PADDLE_WIDTH + BALL_SIZE / 2;
        }

        if (
          state.ball.x + BALL_SIZE / 2 >= CANVAS_WIDTH - 20 - PADDLE_WIDTH &&
          state.ball.x + BALL_SIZE / 2 <= CANVAS_WIDTH - 20 &&
          state.ball.y >= state.paddle2Y &&
          state.ball.y <= state.paddle2Y + PADDLE_HEIGHT &&
          state.ball.vx > 0
        ) {
          state.ball.vx = -Math.abs(state.ball.vx);
          state.ball.x = CANVAS_WIDTH - 20 - PADDLE_WIDTH - BALL_SIZE / 2;
        }

        if (state.ball.x < 0) {
          state.score2++;
          resetBall(1);
        }
        if (state.ball.x > CANVAS_WIDTH) {
          state.score1++;
          resetBall(-1);
        }

        if (
          state.score1 !== scoresRef.current.score1 ||
          state.score2 !== scoresRef.current.score2
        ) {
          scoresRef.current = { score1: state.score1, score2: state.score2 };
          setScores(scoresRef.current);
        }
      }

      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(
          JSON.stringify({ type: "gameState", state })
        );
      }
    } else if (currentRole === "guest") {
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

    if (paddle1Ref.current) paddle1Ref.current.y = state.paddle1Y;
    if (paddle2Ref.current) paddle2Ref.current.y = state.paddle2Y;
    if (ballRef.current) {
      ballRef.current.x = state.ball.x;
      ballRef.current.y = state.ball.y;
    }

    gameLoopRef.current = requestAnimationFrame(updateGame);
  }, []);

  const stopGameLoop = () => {
    if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
  };

  const endSession = () => {
    stopGameLoop();
    setConnected(false);
    setInviteLink("");
    setAnswerCode("");
    setAnswerInput("");
    setRole("none");
    roleRef.current = "none";
    setGamePhase("idle");
    gamePhaseRef.current = "idle";
    resetState();

    if (dataChannelRef.current) dataChannelRef.current.close();
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    dataChannelRef.current = null;
    peerConnectionRef.current = null;

    if (pixiAppRef.current) {
      pixiAppRef.current.stage.removeChildren();
      pixiAppRef.current.destroy(true);
      pixiAppRef.current = null;
    }
    initPixi();

    if (onExitToMenu) onExitToMenu();
  };

  useEffect(() => {
    if (connected) {
      gameLoopRef.current = requestAnimationFrame(updateGame);
    }
    return () => stopGameLoop();
  }, [connected, updateGame]);

  useEffect(() => {
    initPixi();
    return () => {
      if (pixiAppRef.current) {
        pixiAppRef.current.destroy(true);
        pixiAppRef.current = null;
      }
    };
  }, [initPixi]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "w", "s"].includes(e.key)) {
        e.preventDefault();
        keysRef.current.add(e.key);
      }
      if (e.key === "Escape") endSession();
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

  useEffect(() => {
    if (
      webcamDialogOpen &&
      !faceCapturing &&
      videoRef.current &&
      webcamStreamRef.current
    ) {
      videoRef.current.srcObject = webcamStreamRef.current;
    }
  }, [webcamDialogOpen, faceCapturing]);

  useEffect(() => {
    ballSpeedRef.current = ballSpeed;
    if (roleRef.current === "host") {
      const direction = Math.sign(gameStateRef.current.ball.vx) || 1;
      gameStateRef.current.ball.vx = direction * ballSpeed;
      gameStateRef.current.ball.vy =
        (ballSpeed / 2) * Math.sign(gameStateRef.current.ball.vy || 1);
      broadcastSettings(ballSpeed);
    }
  }, [ballSpeed]);

  useEffect(() => {
    const immersive =
      connected || gamePhase === "countdown" || gamePhase === "playing";
    onImmersiveChange?.(immersive);
  }, [connected, gamePhase, onImmersiveChange]);

  const isImmersive =
    connected || gamePhase === "countdown" || gamePhase === "playing";

  return (
    <Box
      className="pong-wrapper"
      sx={{
        width: "100%",
        minHeight: isImmersive ? "100vh" : "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        py: isImmersive ? 0 : 2,
      }}
    >
      <Paper
        elevation={12}
        sx={{
          position: "relative",
          borderRadius: isImmersive ? 0 : 3,
          overflow: "hidden",
          border: "1px solid rgba(124,241,255,0.25)",
          background:
            "radial-gradient(circle at 10% 20%, rgba(124,241,255,0.07), transparent 35%), #050914",
        }}
      >
        <Box
          sx={{
            p: isImmersive ? 0 : 2.5,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Box
            sx={{
              position: "relative",
              borderRadius: isImmersive ? 0 : 2,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 25px 70px rgba(0,0,0,0.45)",
            }}
          >
            <Box ref={gameContainerRef} sx={{ background: "#050914" }} />

            <Box
              sx={{
                position: "absolute",
                top: 12,
                left: 0,
                right: 0,
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <Chip
                label={`${scores.score1} : ${scores.score2}`}
                sx={{
                  bgcolor: "rgba(0,0,0,0.55)",
                  color: "#f1f5ff",
                  fontSize: 18,
                  px: 2,
                  py: 1,
                  backdropFilter: "blur(6px)",
                  pointerEvents: "none",
                }}
              />
            </Box>

            {isImmersive && (
              <Button
                variant="contained"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={endSession}
                sx={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  zIndex: 2,
                  backdropFilter: "blur(6px)",
                }}
              >
                Ukončiť
              </Button>
            )}

            {gamePhase === "countdown" && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.45)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <Typography
                  variant="h2"
                  sx={{ color: "#7cf1ff", fontWeight: 800 }}
                >
                  {countdown}
                </Typography>
              </Box>
            )}
          </Box>

          {status && !isImmersive && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {status}
            </Alert>
          )}
        </Box>
      </Paper>

      {!isImmersive && (
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ width: "100%" }}
        >
          <Paper
            sx={{
              flex: 2,
              p: 3,
              borderRadius: 2,
              background: "linear-gradient(145deg, #0d1526, #0b1221)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {role === "none" && (
              <Stack spacing={2}>
                <Typography variant="h6">Začni novú hru</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
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
                    color="inherit"
                    onClick={openWebcamDialog}
                    startIcon={<VideocamIcon />}
                  >
                    Odfotiť tvár
                  </Button>
                  <Chip
                    label={`Rýchlosť loptičky ${ballSpeed}`}
                    color="secondary"
                  />
                  {hostFaceImage && (
                    <Chip
                      label="Tvár pripravená"
                      color="success"
                      variant="outlined"
                    />
                  )}
                </Stack>
              </Stack>
            )}

            {role === "host" && !connected && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {inviteLink && (
                  <>
                    <Typography>Pošli tento link kamarátovi:</Typography>
                    <TextField
                      fullWidth
                      value={inviteLink}
                      InputProps={{
                        readOnly: true,
                        sx: {
                          bgcolor: "#050914",
                          fontFamily: "monospace",
                          fontSize: "0.85rem",
                        },
                      }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        onClick={() => copyToClipboard(inviteLink)}
                        startIcon={<ContentCopyIcon />}
                      >
                        Kopírovať link
                      </Button>
                      <Button
                        variant="outlined"
                        color="inherit"
                        onClick={openWebcamDialog}
                        startIcon={<VideocamIcon />}
                      >
                        Odfotiť tvár
                      </Button>
                    </Stack>

                    <Typography variant="body1" sx={{ mt: 1 }}>
                      Vlož kód odpovede od kamaráta:
                    </Typography>
                    <TextField
                      fullWidth
                      value={answerInput}
                      onChange={(e) => setAnswerInput(e.target.value)}
                      placeholder="Vlož kód odpovede..."
                      InputProps={{ sx: { bgcolor: "#050914" } }}
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

                {!inviteLink && (
                  <Typography color="rgba(255,255,255,0.7)">
                    Klikni na Vytvoriť hru a vygeneruj odkaz.
                  </Typography>
                )}
              </Stack>
            )}

            {role === "guest" && !connected && (
              <Stack spacing={2}>
                {answerCode ? (
                  <>
                    <Typography>Pošli tento kód hostiteľovi:</Typography>
                    <TextField
                      fullWidth
                      multiline
                      rows={3}
                      value={answerCode}
                      InputProps={{
                        readOnly: true,
                        sx: {
                          bgcolor: "#050914",
                          fontFamily: "monospace",
                          fontSize: "0.8rem",
                        },
                      }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        onClick={() => copyToClipboard(answerCode)}
                        startIcon={<ContentCopyIcon />}
                      >
                        Kopírovať kód
                      </Button>
                      <Button
                        variant="outlined"
                        color="inherit"
                        onClick={openWebcamDialog}
                        startIcon={<VideocamIcon />}
                      >
                        Odfotiť tvár
                      </Button>
                      {guestFaceImage && (
                        <Chip
                          label="Tvár pripravená"
                          color="success"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </>
                ) : (
                  <Box textAlign="center" py={2}>
                    <CircularProgress />
                    <Typography sx={{ mt: 1 }}>Generujem odpoveď...</Typography>
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
                  color="inherit"
                  onClick={openWebcamDialog}
                  startIcon={<VideocamIcon />}
                >
                  Zmeniť tvár
                </Button>
              </Stack>
            )}
          </Paper>

          <Paper
            sx={{
              flex: 1,
              p: 3,
              borderRadius: 2,
              background: "linear-gradient(150deg, #0b1425, #0a1321)",
              border: "1px solid rgba(255,255,255,0.05)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Typography variant="h6">Rýchlosť loptičky</Typography>
            <Slider
              value={ballSpeed}
              min={3}
              max={11}
              step={0.5}
              onChange={(_, value) => setBallSpeed(value as number)}
              valueLabelDisplay="auto"
            />
            <Typography variant="body2" color="rgba(255,255,255,0.72)">
              Pomalšia loptička je čitateľnejšia. Host posiela nastavenie aj
              hosťovi.
            </Typography>

            <Typography variant="h6" sx={{ mt: 1 }}>
              Ako hrať
            </Typography>
            <Typography
              variant="body2"
              color="rgba(255,255,255,0.72)"
              component="div"
            >
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>Host vytvorí hru a pošle link.</li>
                <li>Guest otvorí link, vráti kód, host ho vloží.</li>
                <li>
                  Prebehne krátke odpočítavanie, až potom sa hýbe loptička.
                </li>
                <li>Šípky alebo W/S ovládajú pálku.</li>
              </ol>
            </Typography>
          </Paper>
        </Stack>
      )}

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
                  maxWidth: 420,
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

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />
    </Box>
  );
}
