import { Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";

function PTTPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--base)] text-[var(--text)]">
      <div className="text-center">
        <h1 className="mb-2 font-mono text-2xl font-bold">TinyVoice</h1>
        <p className="text-sm text-[var(--subtext)]">
          Push-to-talk voice chat — coming soon
        </p>
      </div>
    </div>
  );
}

function QRPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--base)] text-[var(--text)]">
      <div className="text-center">
        <h1 className="mb-2 font-mono text-2xl font-bold">Voice QR</h1>
        <p className="text-sm text-[var(--subtext)]">
          Record, encode, share via QR — coming soon
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<PTTPage />} />
        <Route path="/qr" element={<QRPage />} />
      </Routes>
    </ThemeProvider>
  );
}
