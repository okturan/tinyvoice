import { Card, CardContent } from "@/components/ui/card";
import QualityPicker from "../QualityPicker";
import type { RecordFlow } from "@/hooks/useRecordFlow";

export function QualityCard({ flow, vertical = false }: { flow: RecordFlow; vertical?: boolean }) {
  return (
    <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
      <CardContent className="py-3 px-4">
        <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
          Quality
        </div>
        <QualityPicker
          value={flow.quality}
          onChange={flow.handleQualityChange}
          refreshKey={flow.codecContext.loadedQualities.length}
          vertical={vertical}
        />
      </CardContent>
    </Card>
  );
}
