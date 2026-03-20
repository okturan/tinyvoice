import { Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { CodecProvider } from "@/contexts/CodecContext";
import { StatsProvider } from "@/contexts/StatsContext";
import { PTTPage } from "@/pages/PTTPage";
import QRPage from "@/pages/QRPage";

export default function App() {
  return (
    <ThemeProvider>
      <CodecProvider>
        <StatsProvider>
          <Routes>
            <Route path="/" element={<PTTPage />} />
            <Route path="/qr" element={<QRPage />} />
          </Routes>
        </StatsProvider>
      </CodecProvider>
    </ThemeProvider>
  );
}
