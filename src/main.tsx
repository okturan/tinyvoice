import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import QRPage from "./pages/QRPage";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/qr" element={<QRPage />} />
        <Route path="/" element={<div>PTT Page (coming soon)</div>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
