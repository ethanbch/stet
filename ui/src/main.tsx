import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/jetbrains-mono";
import "./readout/readout.css";
import "./readout/readout-components.css";
import "./app.css";
import { App } from "./App";

// Bundled fonts: the interface works offline and never calls a font CDN.
document.documentElement.style.setProperty("--font-sans", '"IBM Plex Sans Variable", system-ui, -apple-system, sans-serif');
document.documentElement.style.setProperty("--font-mono", '"JetBrains Mono Variable", ui-monospace, Menlo, monospace');

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
