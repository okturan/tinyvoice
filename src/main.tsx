import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./themes.css";

// Set initial theme from localStorage
const savedTheme = localStorage.getItem("fc-theme") || "mocha";
document.documentElement.dataset.theme = savedTheme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
