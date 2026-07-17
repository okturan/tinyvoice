import { Card, CardContent } from "@/components/ui/card";
import QRResult from "../QRResult";
import { QualityCard } from "./QualityCard";
import { CodecCard } from "./CodecCard";
import { RecordButton } from "./RecordButton";
import { RecordFlowChrome } from "./RecordFlowChrome";
import { TrimToggle } from "./TrimToggle";
import { useRecordFlow } from "@/hooks/useRecordFlow";

/**
 * Split Deck ethos — controls dock into a left rail, the result owns the
 * wide right pane. Falls back to a stacked column on narrow screens.
 */
export default function SplitDeckRecord() {
  const flow = useRecordFlow();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto sm:flex-row sm:overflow-visible">
      {/* Control rail */}
      <div className="flex flex-shrink-0 flex-col gap-3 sm:w-[200px]">
        <QualityCard flow={flow} vertical />
        <CodecCard flow={flow} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-3">
          <RecordButton flow={flow} size="sm" />
          <TrimToggle flow={flow} />
        </div>
      </div>

      {/* Result pane */}
      <div className="min-h-0 flex-1 sm:overflow-y-auto">
        {flow.encodeResult ? (
          <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
            <CardContent className="py-4 px-4">
              <QRResult
                packed={flow.encodeResult.packed}
                duration={flow.encodeResult.duration}
                onHexOpen={() => flow.setHexOpen(true)}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed border-[var(--surface0)]">
            <p className="px-6 text-center text-xs text-[var(--overlay)]">
              Hold to record — your QR appears here
            </p>
          </div>
        )}
      </div>

      <RecordFlowChrome flow={flow} />
    </div>
  );
}
