import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ForestIcon from "@mui/icons-material/Forest";
import PongGame from "./PongGame";
import MultiSnake from "./MultiSnake";
import "./App.css";

type GameKey = "pong" | "snake" | null;

export default function App() {
  const [activeGame, setActiveGame] = useState<GameKey>(null);
  const [immersive, setImmersive] = useState(false);

  const exitToMenu = () => {
    setActiveGame(null);
    setImmersive(false);
  };

  useEffect(() => {
    const target = document.documentElement;
    const previous = target.style.overflow;
    target.style.overflow = immersive ? "hidden" : "auto";
    return () => {
      target.style.overflow = previous;
    };
  }, [immersive]);

  return (
    <div className={`app-shell ${immersive ? "app-shell--immersive" : ""}`}>
      {!immersive && (
        <header className="hero hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">Playroom</div>
            <h1>
              WebRTC Arcade
              <AutoAwesomeIcon className="spark" />
            </h1>
            <p>
              Dve hry, jeden link. Pozvi kamaráta do Pongu alebo Snake duelu,
              oba bežia cez WebRTC a Pixi.
            </p>
            <Stack direction="row" spacing={1} className="badge-row">
              <Chip label="Multiplayer" color="primary" variant="outlined" />
              <Chip label="Pixi visuals" color="secondary" variant="outlined" />
              <Chip label="Countdown start" variant="outlined" />
            </Stack>
            <div className="hero-actions">
              <Button
                variant="contained"
                color="primary"
                size="large"
                startIcon={<SportsEsportsIcon />}
                onClick={() => setActiveGame("pong")}
              >
                Štart Pong
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                size="large"
                startIcon={<ForestIcon />}
                onClick={() => setActiveGame("snake")}
              >
                Snake Duel
              </Button>
            </div>
          </div>

          <div className="card-column">
            <Card className="game-card" onClick={() => setActiveGame("pong")}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <SportsEsportsIcon color="primary" />
                  <Typography variant="h6">WebRTC Pong</Typography>
                </Stack>
                <Typography className="card-copy">
                  Rýchlosť loptičky nastavíš v lobby, krátke odpočítavanie a
                  fullscreen ihrisko bez rušivého scrollu.
                </Typography>
                <Stack direction="row" spacing={1} className="badges">
                  <Chip label="Custom speed" variant="outlined" />
                  <Chip label="Face paddles" variant="outlined" />
                </Stack>
              </CardContent>
            </Card>

            <Card className="game-card" onClick={() => setActiveGame("snake")}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <ForestIcon color="success" />
                  <Typography variant="h6">Snake Duel (Pixi)</Typography>
                </Stack>
                <Typography className="card-copy">
                  Host hrá šípkami, guest W/A/S/D. Pixi mriežka, countdown a
                  synchronizované skóre.
                </Typography>
                <Stack direction="row" spacing={1} className="badges">
                  <Chip
                    label="Multiplayer"
                    color="primary"
                    variant="outlined"
                  />
                  <Chip label="No lag grid" variant="outlined" />
                </Stack>
              </CardContent>
            </Card>
          </div>
        </header>
      )}

      {activeGame === "pong" && (
        <PongGame
          onExitToMenu={exitToMenu}
          onImmersiveChange={(value) => setImmersive(value)}
        />
      )}

      {activeGame === "snake" && (
        <MultiSnake
          onExitToMenu={exitToMenu}
          onImmersiveChange={(value) => setImmersive(value)}
        />
      )}
    </div>
  );
}
