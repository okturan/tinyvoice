import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import QRResult from "../QRResult";
import { QualityCard } from "./QualityCard";
import { CodecCard } from "./CodecCard";
import { RecordButton } from "./RecordButton";
import { RecordFlowChrome } from "./RecordFlowChrome";
import { TrimToggle } from "./TrimToggle";
import { useRecordFlow } from "@/hooks/useRecordFlow";
import { qualityLabel } from "@/lib/format";

/**
 * Stage Swap ethos — camera-app model. Recording and result are separate
 * stages; encoding swaps the whole canvas to the result.
 */
export default function StageSwapRecord() {
  const flow = useRecordFlow();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!flow.encodeResult ? (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <QualityCard flow={flow} />
          <CodecCard flow={flow} />
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
            <RecordButton flow={flow} />
            <TrimToggle flow={flow} />
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={flow.resetResult}>
              ← New recording
            </Button>
            <span className="ml-auto font-mono text-[0.65rem] text-[var(--overlay)]">
              {qualityLabel(flow.quality)} ·{" "}
              <b className="font-semibold text-[var(--green)]">
                {flow.encodeResult.duration.toFixed(1)}s → {flow.encodeResult.packed.length} B
              </b>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
              <CardContent className="py-4 px-4">
                <QRResult
                  packed={flow.encodeResult.packed}
                  duration={flow.encodeResult.duration}
                  onHexOpen={() => flow.setHexOpen(true)}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      <RecordFlowChrome flow={flow} />
    </div>
  );
}
