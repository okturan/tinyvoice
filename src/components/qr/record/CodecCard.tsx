import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import type { RecordFlow } from "@/hooks/useRecordFlow";

export function CodecCard({ flow }: { flow: RecordFlow }) {
  const {
    codecContext,
    modelsLoaded,
    loadingModels,
    cacheState,
    audioReady,
    encodeProgress,
    loadedStatus,
    displayStatus,
    displayStatusType,
    showDisplayStatus,
  } = flow;

  return (
    <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
      <CardContent className="py-3 px-4">
        <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
          Codec
        </div>
        {!modelsLoaded ? (
          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={cacheState === "all" ? flow.handleLoadModels : () => flow.setDownloadOpen(true)}
              disabled={loadingModels}
            >
              {loadingModels
                ? "Loading models..."
                : cacheState === "all"
                  ? "Load cached models"
                  : "Choose models"}
            </Button>
            {loadingModels && (
              <div className="space-y-2">
                <Progress value={codecContext.progress} className="h-1.5" />
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={codecContext.abortLoading}
                >
                  Cancel download
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-[var(--green)]" />
              <span className="text-xs text-[var(--green)]">
                {loadedStatus}
              </span>
            </div>
            {!audioReady && (
              <Button className="w-full" onClick={flow.handleLoadModels}>
                Enable microphone
              </Button>
            )}
            {encodeProgress > 0 && encodeProgress < 100 && (
              <Progress value={encodeProgress} className="h-1.5" />
            )}
          </div>
        )}
        {showDisplayStatus && <p
          className={`mt-2 min-h-[1.2em] text-[0.7rem] ${
            displayStatusType === "ok"
              ? "text-[var(--green)]"
              : displayStatusType === "err"
                ? "text-[var(--red)]"
                : "text-[var(--overlay)]"
          }`}
        >
          {displayStatus}
        </p>}
      </CardContent>
    </Card>
  );
}
