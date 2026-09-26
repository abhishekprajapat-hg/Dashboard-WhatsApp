
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  // Screens load on first open, so a tab left open across a deploy can ask for a file the new
  // build no longer has. Reload once to pick up the new build instead of showing a blank screen;
  // the timestamp guard stops a reload loop if the file is genuinely missing.
  window.addEventListener("vite:preloadError", (event) => {
    const KEY = "nemnidhi_reloaded_for_update";
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) || 0);
    } catch {
      // storage unavailable - fall through and reload once
    }
    if (Date.now() - last < 30_000) return;
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // ignore
    }
    event.preventDefault();
    window.location.reload();
  });

  createRoot(document.getElementById("root")!).render(<App />);
