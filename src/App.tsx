import { Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { CodecProvider } from "@/contexts/CodecContext";
import { StatsProvider } from "@/contexts/StatsContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PTTPage } from "@/pages/PTTPage";
import QRPage from "@/pages/QRPage";

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <CodecProvider>
          <StatsProvider>
            <Routes>
              <Route path="/" element={<PTTPage />} />
              <Route path="/qr" element={<QRPage />} />
            </Routes>
          </StatsProvider>
        </CodecProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
