import { TooltipProvider } from "@/components/ui/tooltip";
import { CodecProvider } from "@/contexts/CodecContext";
import { StatsProvider } from "@/contexts/StatsContext";
import { PTTPage } from "@/pages/PTTPage";

export default function App() {
  return (
    <TooltipProvider>
      <CodecProvider>
        <StatsProvider>
          <PTTPage />
        </StatsProvider>
      </CodecProvider>
    </TooltipProvider>
  );
}
