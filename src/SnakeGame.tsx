import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";

const GRID_SIZE = 18;
const BOARD_SIZE = 18;
const INITIAL_SPEED = 160;

type Direction = "up" | "down" | "left" | "right";
type Cell = { x: number; y: number };

type SnakeGameProps = {
  onExit?: () => void;
};

const OFFSETS: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export default function SnakeGame({ onExit }: SnakeGameProps) {
  const [snake, setSnake] = useState<Cell[]>([
    { x: 4, y: 8 },
    { x: 3, y: 8 },
    { x: 2, y: 8 },
  ]);
  const [direction, setDirection] = useState<Direction>("right");
  const [food, setFood] = useState<Cell>({ x: 10, y: 8 });
  const [score, setScore] = useState(0);
  const [speed, setSpeed] = useState(INITIAL_SPEED);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const timerRef = useRef<number | null>(null);
  const pendingDirection = useRef<Direction>("right");
  const foodRef = useRef<Cell>({ x: 10, y: 8 });

  const cells = useMemo(() => BOARD_SIZE * BOARD_SIZE, []);

  const placeFoodFromSnake = useCallback((currentSnake: Cell[]) => {
    const occupied = new Set(currentSnake.map((c) => `${c.x}-${c.y}`));
    let x = Math.floor(Math.random() * BOARD_SIZE);
    let y = Math.floor(Math.random() * BOARD_SIZE);
    while (occupied.has(`${x}-${y}`)) {
      x = Math.floor(Math.random() * BOARD_SIZE);
      y = Math.floor(Math.random() * BOARD_SIZE);
    }
    const nextFood = { x, y };
    foodRef.current = nextFood;
    setFood(nextFood);
  }, []);

  const resetGame = () => {
    setSnake([
      { x: 4, y: 8 },
      { x: 3, y: 8 },
      { x: 2, y: 8 },
    ]);
    setDirection("right");
    pendingDirection.current = "right";
    const startFood = { x: 10, y: 8 };
    setFood(startFood);
    foodRef.current = startFood;
    setScore(0);
    setSpeed(INITIAL_SPEED);
    setGameOver(false);
  };

  const step = useCallback(() => {
    setSnake((current) => {
      const head = current[0];
      const offset = OFFSETS[pendingDirection.current];
      const next: Cell = { x: head.x + offset.x, y: head.y + offset.y };

      if (
        next.x < 0 ||
        next.x >= BOARD_SIZE ||
        next.y < 0 ||
        next.y >= BOARD_SIZE
      ) {
        setGameOver(true);
        setRunning(false);
        return current;
      }

      if (current.some((c) => c.x === next.x && c.y === next.y)) {
        setGameOver(true);
        setRunning(false);
        return current;
      }

      const newSnake = [next, ...current];
      const currentFood = foodRef.current;
      const ate = next.x === currentFood.x && next.y === currentFood.y;
      if (!ate) {
        newSnake.pop();
      } else {
        setScore((s) => s + 10);
        placeFoodFromSnake(newSnake);
        setSpeed((s) => Math.max(80, s - 6));
      }

      return newSnake;
    });
  }, [placeFoodFromSnake]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (running) {
      timerRef.current = window.setInterval(step, speed);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running, speed, step]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" && direction !== "down")
        pendingDirection.current = "up";
      if (e.key === "ArrowDown" && direction !== "up")
        pendingDirection.current = "down";
      if (e.key === "ArrowLeft" && direction !== "right")
        pendingDirection.current = "left";
      if (e.key === "ArrowRight" && direction !== "left")
        pendingDirection.current = "right";
      if (e.key === " ") setRunning((r) => !r);
      if (e.key === "r") {
        resetGame();
        setRunning(true);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [direction]);

  useEffect(() => {
    setDirection(pendingDirection.current);
  }, [snake]);

  useEffect(() => {
    resetGame();
  }, []);

  useEffect(() => {
    foodRef.current = food;
  }, [food]);

  const renderCell = (index: number) => {
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    const isHead = snake[0].x === x && snake[0].y === y;
    const onSnake = snake.some((c) => c.x === x && c.y === y);
    const isFood = food.x === x && food.y === y;

    const background = isHead
      ? "linear-gradient(135deg, #f5c542 0%, #f08b2f 100%)"
      : onSnake
      ? "#13313f"
      : "rgba(255,255,255,0.04)";

    return (
      <Box
        key={`${x}-${y}`}
        sx={{
          width: GRID_SIZE,
          height: GRID_SIZE,
          background,
          borderRadius: isHead ? 6 : 4,
          border: isFood
            ? "1px solid #f5c542"
            : "1px solid rgba(255,255,255,0.03)",
          position: "relative",
          boxShadow: isHead ? "0 8px 18px rgba(0,0,0,0.35)" : undefined,
          transition: "background 120ms ease, box-shadow 120ms ease",
        }}
      >
        {isFood && (
          <Box
            sx={{
              position: "absolute",
              inset: 4,
              borderRadius: 50,
              background:
                "radial-gradient(circle at 25% 25%, #ffe8a3, #f08b2f)",
              boxShadow: "0 0 12px rgba(240,139,47,0.55)",
            }}
          />
        )}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: 760,
        mx: "auto",
        p: 3,
        borderRadius: 3,
        background:
          "linear-gradient(145deg, #0c1b24 0%, #0a1218 60%, #0f1f2d 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="h5" sx={{ color: "#e9f3ff", fontWeight: 700 }}>
            Solo Snake
          </Typography>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>
            Šípky na pohyb, medzerník pauza, R reštart.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            label={`Score ${score}`}
            sx={{
              bgcolor: "rgba(245,197,66,0.14)",
              color: "#f5c542",
              fontWeight: 700,
              border: "1px solid rgba(245,197,66,0.4)",
            }}
          />
          <Button variant="outlined" color="inherit" onClick={resetGame}>
            Reštart
          </Button>
          {onExit && (
            <Button variant="contained" color="error" onClick={onExit}>
              Späť do menu
            </Button>
          )}
        </Stack>
      </Stack>

      <Box
        sx={{
          mt: 3,
          display: "grid",
          gridTemplateColumns: `repeat(${BOARD_SIZE}, ${GRID_SIZE}px)`,
          gap: 2,
          justifyContent: "center",
          position: "relative",
          padding: 2,
          borderRadius: 3,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {Array.from({ length: cells }).map((_, idx) => renderCell(idx))}
        {!running && !gameOver && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(4px)",
              borderRadius: 3,
            }}
          >
            <Stack spacing={1} alignItems="center">
              <Typography
                variant="h4"
                sx={{ color: "#e9f3ff", fontWeight: 800 }}
              >
                Stlač medzerník na štart
              </Typography>
              <Typography sx={{ color: "rgba(255,255,255,0.72)" }}>
                Zrýchľuj postupne, jedlo pridá body aj tempo.
              </Typography>
              <Button variant="contained" onClick={() => setRunning(true)}>
                Štart
              </Button>
            </Stack>
          </Box>
        )}
        {gameOver && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.48)",
              backdropFilter: "blur(5px)",
              borderRadius: 3,
            }}
          >
            <Stack spacing={1} alignItems="center">
              <Typography
                variant="h4"
                sx={{ color: "#f05f5f", fontWeight: 800 }}
              >
                Game Over
              </Typography>
              <Typography sx={{ color: "rgba(255,255,255,0.8)" }}>
                Výsledok {score}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  onClick={() => {
                    resetGame();
                    setRunning(true);
                  }}
                >
                  Hrať znova
                </Button>
                {onExit && (
                  <Button variant="outlined" color="inherit" onClick={onExit}>
                    Späť do menu
                  </Button>
                )}
              </Stack>
            </Stack>
          </Box>
        )}
      </Box>
    </Box>
  );
}
