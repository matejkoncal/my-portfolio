import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  // StrictMode disabled for WebRTC - it causes double initialization
  <App />
);
