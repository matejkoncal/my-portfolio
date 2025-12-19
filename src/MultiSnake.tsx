import { useCallback, useEffect, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import pako from "pako";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import LogoutIcon from "@mui/icons-material/Logout";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

const TILE = 26;
const COLS = 24;
const ROWS = 16;
const CANVAS_WIDTH = COLS * TILE;
const CANVAS_HEIGHT = ROWS * TILE;
const INITIAL_INTERVAL = 150;

const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

type Direction = "up" | "down" | "left" | "right";
type Cell = { x: number; y: number };
type GamePhase = "idle" | "lobby" | "countdown" | "playing" | "over";

type GameState = {
  snake1: Cell[];
  snake2: Cell[];
  dir1: Direction;
  dir2: Direction;
  food: Cell;
  score1: number;
  score2: number;
  phase: GamePhase;
};

type Props = {
  onExitToMenu?: () => void;
  onImmersiveChange?: (value: boolean) => void;
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

const opposite: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export default function MultiSnake({ onExitToMenu, onImmersiveChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const foodGfxRef = useRef<Graphics | null>(null);
  const snake1GfxRef = useRef<Graphics | null>(null);
  const snake2GfxRef = useRef<Graphics | null>(null);
  const gridGfxRef = useRef<Graphics | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const roleRef = useRef<"none" | "host" | "guest">("none");

  const [role, setRole] = useState<"none" | "host" | "guest">("none");
  const [status, setStatus] = useState("Pripravené na vytvorenie hry");
  const [inviteLink, setInviteLink] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [answerInput, setAnswerInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const countdownTimerRef = useRef<number | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>("idle");
  const gamePhaseRef = useRef<GamePhase>("idle");
  const [scores, setScores] = useState({ score1: 0, score2: 0 });

  const intervalRef = useRef<number | null>(null);
  const speedRef = useRef(INITIAL_INTERVAL);
  const dir1Ref = useRef<Direction>("right");
  const dir2Ref = useRef<Direction>("left");

  const gameStateRef = useRef<GameState>({
    snake1: [
      { x: 4, y: 8 },
      { x: 3, y: 8 },
      { x: 2, y: 8 },
    ],
    snake2: [
      { x: COLS - 5, y: 8 },
      { x: COLS - 4, y: 8 },
      { x: COLS - 3, y: 8 },
    ],
    dir1: "right",
    dir2: "left",
    food: { x: 12, y: 6 },
    score1: 0,
    score2: 0,
    phase: "idle",
  });

  const showToast = (message: string) => setSnackbar(message);

  const placeFood = useCallback((snakeA: Cell[], snakeB: Cell[]): Cell => {
    const occupied = new Set(
      [...snakeA, ...snakeB].map((c) => `${c.x}-${c.y}`)
    );
    let x = Math.floor(Math.random() * COLS);
    let y = Math.floor(Math.random() * ROWS);
    while (occupied.has(`${x}-${y}`)) {
      x = Math.floor(Math.random() * COLS);
      y = Math.floor(Math.random() * ROWS);
    }
    return { x, y };
  }, []);

  const resetGameState = useCallback(() => {
    const snake1 = [
      { x: 4, y: 8 },
      { x: 3, y: 8 },
      { x: 2, y: 8 },
    ];
    const snake2 = [
      { x: COLS - 5, y: 8 },
      { x: COLS - 4, y: 8 },
      { x: COLS - 3, y: 8 },
    ];
    const food = placeFood(snake1, snake2);
    gameStateRef.current = {
      snake1,
      snake2,
      dir1: "right",
      dir2: "left",
      food,
      score1: 0,
      score2: 0,
      phase: "lobby",
    };
    dir1Ref.current = "right";
    dir2Ref.current = "left";
    setScores({ score1: 0, score2: 0 });
    speedRef.current = INITIAL_INTERVAL;
    setGamePhase("lobby");
    gamePhaseRef.current = "lobby";
  }, [placeFood]);

  const drawState = useCallback((state: GameState) => {
    if (!appRef.current) return;
    const snake1Gfx = snake1GfxRef.current;
    const snake2Gfx = snake2GfxRef.current;
    const foodGfx = foodGfxRef.current;

    if (snake1Gfx && snake2Gfx && foodGfx) {
      snake1Gfx.clear();
      snake2Gfx.clear();
      foodGfx.clear();

      state.snake1.forEach((cell, idx) => {
        snake1Gfx.beginFill(idx === 0 ? 0x7cf1ff : 0x1ea1ff);
        snake1Gfx.drawRoundedRect(
          cell.x * TILE,
          cell.y * TILE,
          TILE - 2,
          TILE - 2,
          4
        );
        snake1Gfx.endFill();
      });

      state.snake2.forEach((cell, idx) => {
        snake2Gfx.beginFill(idx === 0 ? 0xffc857 : 0xf08b2f);
        snake2Gfx.drawRoundedRect(
          cell.x * TILE,
          cell.y * TILE,
          TILE - 2,
          TILE - 2,
          4
        );
        snake2Gfx.endFill();
      });

      foodGfx.beginFill(0xf05f5f);
      foodGfx.drawCircle(
        state.food.x * TILE + TILE / 2,
        state.food.y * TILE + TILE / 2,
        TILE / 3
      );
      foodGfx.endFill();
    }
  }, []);

  const initPixi = useCallback(async () => {
    if (!containerRef.current || appRef.current) return;

    const app = new Application();
    await app.init({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: 0x050914,
      antialias: true,
    });

    const grid = new Graphics();
    grid.lineStyle(1, 0x0f1523, 0.8);
    for (let x = 0; x <= COLS; x++) {
      grid.moveTo(x * TILE, 0);
      grid.lineTo(x * TILE, CANVAS_HEIGHT);
    }
    for (let y = 0; y <= ROWS; y++) {
      grid.moveTo(0, y * TILE);
      grid.lineTo(CANVAS_WIDTH, y * TILE);
    }
    gridGfxRef.current = grid;
    app.stage.addChild(grid);

    const snake1 = new Graphics();
    const snake2 = new Graphics();
    const food = new Graphics();
    snake1GfxRef.current = snake1;
    snake2GfxRef.current = snake2;
    foodGfxRef.current = food;

    app.stage.addChild(food);
    app.stage.addChild(snake1);
    app.stage.addChild(snake2);

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(app.canvas);
    appRef.current = app;

    drawState(gameStateRef.current);
  }, [drawState]);

  const stopInterval = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const updateScores = (state: GameState) => {
    const next = { score1: state.score1, score2: state.score2 };
    setScores(next);
  };

  const applyStateFromHost = (state: GameState) => {
    gameStateRef.current = state;
    updateScores(state);
    drawState(state);
  };

  const stepGame = useCallback(() => {
    const state = gameStateRef.current;
    if (gamePhaseRef.current !== "playing") return;

    const advance = (snake: Cell[], dir: Direction) => {
      const head = snake[0];
      const delta: Record<Direction, Cell> = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
      };
      const next: Cell = { x: head.x + delta[dir].x, y: head.y + delta[dir].y };
      const hitsWall =
        next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS;
      return { next, hitsWall };
    };

    const dir1 = dir1Ref.current;
    const dir2 = dir2Ref.current;
    state.dir1 = dir1;
    state.dir2 = dir2;

    const { next: next1, hitsWall: wall1 } = advance(state.snake1, dir1);
    const { next: next2, hitsWall: wall2 } = advance(state.snake2, dir2);

    const snake1HitsSelf = state.snake1.some(
      (c) => c.x === next1.x && c.y === next1.y
    );
    const snake2HitsSelf = state.snake2.some(
      (c) => c.x === next2.x && c.y === next2.y
    );
    const headCollision = next1.x === next2.x && next1.y === next2.y;
    const snake1HitsOther = state.snake2.some(
      (c) => c.x === next1.x && c.y === next1.y
    );
    const snake2HitsOther = state.snake1.some(
      (c) => c.x === next2.x && c.y === next2.y
    );

    const anyCrash =
      wall1 ||
      wall2 ||
      snake1HitsSelf ||
      snake2HitsSelf ||
      headCollision ||
      snake1HitsOther ||
      snake2HitsOther;

    if (anyCrash) {
      state.phase = "over";
      gamePhaseRef.current = "over";
      stopInterval();
      if (channelRef.current?.readyState === "open") {
        channelRef.current.send(JSON.stringify({ type: "gameState", state }));
      }
      drawState(state);
      return;
    }

    const ate1 = next1.x === state.food.x && next1.y === state.food.y;
    const ate2 = next2.x === state.food.x && next2.y === state.food.y;

    const nextSnake1 = [next1, ...state.snake1];
    const nextSnake2 = [next2, ...state.snake2];

    if (!ate1) nextSnake1.pop();
    if (!ate2) nextSnake2.pop();

    if (ate1 || ate2) {
      const food = placeFood(nextSnake1, nextSnake2);
      state.food = food;
      if (ate1) state.score1 += 1;
      if (ate2) state.score2 += 1;
      updateScores(state);
    }

    state.snake1 = nextSnake1;
    state.snake2 = nextSnake2;

    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(JSON.stringify({ type: "gameState", state }));
    }

    drawState(state);
  }, [placeFood, drawState]);

  const startCountdown = useCallback(
    (startFrom = 3) => {
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
      setCountdown(startFrom);
      setGamePhase("countdown");
      gamePhaseRef.current = "countdown";

      const tick = (value: number) => {
        setCountdown(value);
        if (
          roleRef.current === "host" &&
          channelRef.current?.readyState === "open"
        ) {
          channelRef.current.send(
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
          if (roleRef.current === "host") {
            stopInterval();
            intervalRef.current = window.setInterval(
              stepGame,
              speedRef.current
            );
          }
          if (
            roleRef.current === "host" &&
            channelRef.current?.readyState === "open"
          ) {
            channelRef.current.send(
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
    },
    [stepGame]
  );

  const waitForICE = (pc: RTCPeerConnection): Promise<void> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000);
      pc.onicecandidate = (event) => {
        if (!event.candidate) {
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

  const setupChannel = useCallback(
    (channel: RTCDataChannel) => {
      channelRef.current = channel;

      channel.onopen = () => {
        setConnected(true);
        setStatus("Pripojené");
        setGamePhase("lobby");
        gamePhaseRef.current = "lobby";
        if (roleRef.current === "host") {
          resetGameState();
          startCountdown();
        }
      };

      channel.onclose = () => {
        setConnected(false);
        setStatus("Spojenie ukončené");
        stopInterval();
      };

      channel.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "gameState" && roleRef.current === "guest") {
          applyStateFromHost(message.state);
        } else if (message.type === "input" && roleRef.current === "host") {
          const next = message.direction as Direction;
          if (next && next !== opposite[dir2Ref.current]) {
            dir2Ref.current = next;
          }
        } else if (message.type === "phase") {
          if (message.phase === "countdown") {
            setGamePhase("countdown");
            gamePhaseRef.current = "countdown";
            setCountdown(message.countdown ?? 3);
          } else if (message.phase === "playing") {
            setGamePhase("playing");
            gamePhaseRef.current = "playing";
          }
        }
      };
    },
    [applyStateFromHost, resetGameState, startCountdown]
  );

  const createGame = async () => {
    setRole("host");
    roleRef.current = "host";
    setStatus("Vytváram hru...");
    resetGameState();

    const pc = new RTCPeerConnection(rtcConfig);
    peerRef.current = pc;
    const channel = pc.createDataChannel("snake");
    setupChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    setStatus("Čakám na ICE kandidátov...");
    await waitForICE(pc);

    const offerData = {
      sdp: pc.localDescription?.sdp,
      type: pc.localDescription?.type,
    };
    const encoded = encodeForURL(offerData);
    const link = `${window.location.origin}${window.location.pathname}?s=${encoded}`;
    setInviteLink(link);
    setStatus("Link vygenerovaný, pošli hosťovi.");
  };

  const handleIncomingOffer = useCallback(
    async (offerData: RTCSessionDescriptionInit) => {
      setRole("guest");
      roleRef.current = "guest";
      setStatus("Pripájam sa k hostovi...");

      const pc = new RTCPeerConnection(rtcConfig);
      peerRef.current = pc;
      pc.ondatachannel = (e) => setupChannel(e.channel);

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
      setStatus("Skopíruj kód a pošli hostiteľovi.");
    },
    [setupChannel]
  );

  const processAnswer = async () => {
    if (!peerRef.current || !answerInput.trim()) return;
    setStatus("Spracovávam odpoveď...");
    try {
      let encoded = answerInput.trim();
      if (encoded.includes("?s=")) encoded = encoded.split("?s=")[1];
      const answerData = decodeFromURL(encoded) as RTCSessionDescriptionInit;
      await peerRef.current.setRemoteDescription(
        new RTCSessionDescription(answerData)
      );
      setStatus("Odpoveď prijatá, čakám na spojenie...");
    } catch (error) {
      console.error(error);
      setStatus("Chyba pri spracovaní odpovede");
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Skopírované");
    } catch {
      showToast("Copy failed");
    }
  };

  const endSession = () => {
    stopInterval();
    if (channelRef.current) channelRef.current.close();
    if (peerRef.current) peerRef.current.close();
    channelRef.current = null;
    peerRef.current = null;
    setConnected(false);
    setInviteLink("");
    setAnswerCode("");
    setAnswerInput("");
    setRole("none");
    roleRef.current = "none";
    setGamePhase("idle");
    gamePhaseRef.current = "idle";
    gameStateRef.current.phase = "idle";
    drawState(gameStateRef.current);
    onExitToMenu?.();
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const data = params.get("s");
    if (data && role === "none") {
      try {
        const offerData = decodeFromURL(data) as RTCSessionDescriptionInit;
        handleIncomingOffer(offerData);
      } catch (err) {
        console.error(err);
        setStatus("Neplatný link");
      }
    }
  }, [role, handleIncomingOffer]);

  useEffect(() => {
    initPixi();
    return () => {
      stopInterval();
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
    };
  }, [initPixi]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        endSession();
        return;
      }

      if (roleRef.current === "host") {
        if (
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
        ) {
          e.preventDefault();
          const map: Record<string, Direction> = {
            ArrowUp: "up",
            ArrowDown: "down",
            ArrowLeft: "left",
            ArrowRight: "right",
          };
          const next = map[e.key];
          if (next && next !== opposite[dir1Ref.current]) {
            dir1Ref.current = next;
          }
        }
      }

      if (roleRef.current === "guest") {
        if (["w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)) {
          e.preventDefault();
          const map: Record<string, Direction> = {
            w: "up",
            s: "down",
            a: "left",
            d: "right",
            W: "up",
            S: "down",
            A: "left",
            D: "right",
          };
          const next = map[e.key];
          if (next && next !== opposite[dir2Ref.current]) {
            channelRef.current?.send(
              JSON.stringify({ type: "input", direction: next })
            );
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    onImmersiveChange?.(
      connected || gamePhase === "countdown" || gamePhase === "playing"
    );
  }, [connected, gamePhase, onImmersiveChange]);

  useEffect(() => {
    drawState(gameStateRef.current);
  }, [drawState]);

  const isImmersive =
    connected || gamePhase === "countdown" || gamePhase === "playing";

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: isImmersive ? "100vh" : "auto",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <Paper
        elevation={10}
        sx={{
          position: "relative",
          borderRadius: isImmersive ? 0 : 3,
          overflow: "hidden",
          border: "1px solid rgba(124,241,255,0.25)",
          background:
            "radial-gradient(circle at 10% 20%, rgba(124,241,255,0.07), transparent 35%), #050914",
        }}
      >
        <Box sx={{ position: "relative" }}>
          <Box ref={containerRef} />

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
              }}
            />
          </Box>

          {isImmersive && (
            <Button
              variant="contained"
              color="error"
              startIcon={<LogoutIcon />}
              onClick={endSession}
              sx={{ position: "absolute", top: 12, right: 12, zIndex: 2 }}
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

          {gamePhase === "over" && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.48)",
                backdropFilter: "blur(5px)",
              }}
            >
              <Stack spacing={2} alignItems="center">
                <Typography
                  variant="h4"
                  sx={{ color: "#f05f5f", fontWeight: 800 }}
                >
                  Game Over
                </Typography>
                <Button
                  variant="contained"
                  onClick={() => {
                    resetGameState();
                    if (roleRef.current === "host") startCountdown();
                  }}
                >
                  Reštart
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      </Paper>

      {!isImmersive && (
        <Paper
          sx={{
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
                  startIcon={<SportsEsportsIcon />}
                  onClick={createGame}
                >
                  Vytvoriť hru (Host)
                </Button>
              </Stack>
            </Stack>
          )}

          {role === "host" && !connected && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {inviteLink ? (
                <>
                  <Typography>Pošli tento link kamarátovi:</Typography>
                  <TextField
                    fullWidth
                    value={inviteLink}
                    InputProps={{
                      readOnly: true,
                      sx: { bgcolor: "#050914", fontFamily: "monospace" },
                    }}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      onClick={() => copy(inviteLink)}
                      startIcon={<ContentCopyIcon />}
                    >
                      Kopírovať link
                    </Button>
                  </Stack>

                  <Typography variant="body1" sx={{ mt: 1 }}>
                    Vlož kód odpovede od kamaráta:
                  </Typography>
                  <TextField
                    fullWidth
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    placeholder="Kód odpovede"
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
              ) : (
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
                      sx: { bgcolor: "#050914", fontFamily: "monospace" },
                    }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => copy(answerCode)}
                    startIcon={<ContentCopyIcon />}
                  >
                    Kopírovať kód
                  </Button>
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
            <Alert severity="success" sx={{ mt: 2 }}>
              Host: šípky. Guest: W/A/S/D. Escape ukončí session.
            </Alert>
          )}

          {status && !connected && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {status}
            </Alert>
          )}
        </Paper>
      )}

      <Snackbar
        open={!!snackbar}
        autoHideDuration={2600}
        message={snackbar ?? ""}
        onClose={() => setSnackbar(null)}
      />
    </Box>
  );
}
