import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  compressorFile,
  decoderFile,
  encoderFile,
  useCodecContext,
  type LoadIntent,
} from "@/contexts/CodecContext";
import { MODEL_SIZE_ESTIMATES_MB, QUALITY_OPTIONS } from "@/lib/constants";
import { Quality } from "@/types/codec";

interface ModelDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultQualities?: Quality[];
  intent?: LoadIntent;
}

function qualityFiles(quality: Quality, intent: LoadIntent): string[] {
  if (intent === "play") return [decoderFile(quality)];
  if (intent === "record") return [compressorFile(quality)];
  return [compressorFile(quality), decoderFile(quality)];
}

export function ModelDownloadDialog({
  open,
  onOpenChange,
  defaultQualities = [],
  intent = "both",
}: ModelDownloadDialogProps) {
  const codec = useCodecContext();
  const rowReady = (quality: Quality) => {
    if (intent === "play") return codec.canPlay(quality);
    if (intent === "record") return codec.canRecord(quality);
    return codec.isQualityLoaded(quality);
  };
  const initialQualities = defaultQualities;
  const initialQualitiesKey = initialQualities.join("|");
  const [selected, setSelected] = useState<Quality[]>(initialQualities);
  const [multiSelect, setMultiSelect] = useState(false);

  useEffect(() => {
    if (open) {
      const selectable = initialQualities.filter((quality) => !rowReady(quality));
      setSelected(selectable);
      setMultiSelect(selectable.length > 1);
    }
  }, [initialQualitiesKey, open, intent, codec.canPlay, codec.canRecord, codec.isQualityLoaded]);

  useEffect(() => {
    if (open) {
      setSelected((current) => current.filter((quality) => !rowReady(quality)));
    }
  }, [open, intent, codec.canPlay, codec.canRecord, codec.isQualityLoaded]);

  const includeEncoder = intent !== "play";
  const encoderCached = codec.cachedFiles.has(encoderFile());
  const loading = codec.state === "loading";

  const isQualityCached = (quality: Quality) =>
    qualityFiles(quality, intent).every((file) => codec.cachedFiles.has(file));

  const qualityDownloadSize = (quality: Quality) =>
    qualityFiles(quality, intent).reduce(
      (sum, file) => sum + (codec.cachedFiles.has(file) ? 0 : MODEL_SIZE_ESTIMATES_MB[file] ?? 0),
      0,
    );

  const selectedPending = selected.filter((quality) => !rowReady(quality));
  const selectedSize =
    selectedPending.length === 0
      ? 0
      : (includeEncoder && !encoderCached ? MODEL_SIZE_ESTIMATES_MB[encoderFile()] ?? 0 : 0) +
        selectedPending.reduce((sum, quality) => sum + qualityDownloadSize(quality), 0);

  const packageSize = (quality: Quality) => {
    return (includeEncoder && !encoderCached ? MODEL_SIZE_ESTIMATES_MB[encoderFile()] ?? 0 : 0) +
      qualityDownloadSize(quality);
  };

  const toggleQuality = (quality: Quality) => {
    if (rowReady(quality)) return;
    setSelected((current) =>
      current.includes(quality)
        ? current.filter((item) => item !== quality)
        : [...current, quality],
    );
  };

  const handleDownload = async (qualities: Quality[]) => {
    const pending = qualities.filter((quality) => !rowReady(quality));
    if (pending.length === 0) {
      onOpenChange(false);
      return;
    }
    const result = await codec.loadModels(pending, intent);
    if (result.ok) {
      await codec.refreshCache();
      onOpenChange(false);
    }
  };

  const cacheReadyLabel = (quality: Quality) => {
    if (intent === "play") return codec.isCachedForPlayback(quality);
    if (intent === "record") return codec.isCachedForRecording(quality);
    return isQualityCached(quality) && encoderCached;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[var(--surface0)] bg-[var(--mantle)] text-[var(--text)] sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base">Download models</DialogTitle>
          <DialogDescription className="text-[0.75rem] text-[var(--overlay)]">
            {intent === "play"
              ? "Playback needs only the decoder for the packet quality."
              : "Start with one quality. The shared encoder is included with your first download."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {includeEncoder && (
            <div className="rounded-md bg-[var(--base)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[0.72rem] text-[var(--text)]">
                    encoder.onnx
                  </div>
                  <div className="text-[0.6rem] text-[var(--overlay)]">
                    Shared recording model
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[0.6rem] text-[var(--overlay)]">595 MB</span>
                  {encoderCached && (
                    <Badge variant="secondary" className="border-0 bg-[var(--green)]/15 px-1.5 py-0 text-[0.5rem] text-[var(--green)]">
                      cached
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}

          {!multiSelect ? (
            <div className="space-y-1.5">
              {QUALITY_OPTIONS.map((option) => {
                const isSuggested = selected.includes(option.value);
                const isLoaded = rowReady(option.value);
                const isCached = isQualityCached(option.value);

                return (
                  <div
                    key={option.value}
                    className={`flex flex-col items-stretch gap-2 rounded-md border px-3 py-2 transition-colors sm:flex-row sm:items-center ${
                      isSuggested
                        ? "border-[var(--tv-accent)] bg-[var(--tv-accent)]/10"
                        : "border-[var(--surface0)] bg-[var(--base)]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[0.78rem] font-semibold text-[var(--text)]">
                          {option.label}
                        </span>
                        {isSuggested && (
                          <Badge variant="secondary" className="border-0 bg-[var(--tv-accent)]/15 px-1.5 py-0 text-[0.5rem] text-[var(--tv-accent)]">
                            suggested
                          </Badge>
                        )}
                        {isLoaded && (
                          <Badge variant="secondary" className="border-0 bg-[var(--green)]/15 px-1.5 py-0 text-[0.5rem] text-[var(--green)]">
                            loaded
                          </Badge>
                        )}
                        {!isLoaded && isCached && (
                          <Badge variant="secondary" className="border-0 bg-[var(--green)]/15 px-1.5 py-0 text-[0.5rem] text-[var(--green)]">
                            cached
                          </Badge>
                        )}
                      </div>
                      <div className="text-[0.6rem] text-[var(--overlay)]">
                        {option.description}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={loading || isLoaded}
                      className="w-full sm:w-auto"
                      onClick={() => handleDownload([option.value])}
                    >
                      {isLoaded
                        ? "Loaded"
                        : cacheReadyLabel(option.value)
                          ? "Load from cache"
                          : `Download (~${packageSize(option.value)} MB)`}
                    </Button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setMultiSelect(true)}
                className="text-[0.65rem] text-[var(--overlay)] transition-colors hover:text-[var(--text)]"
              >
                Select multiple qualities
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {QUALITY_OPTIONS.map((option) => {
                const isSelected = selected.includes(option.value);
                const isLoaded = rowReady(option.value);
                const isCached = isQualityCached(option.value);
                const rowSize = packageSize(option.value);

                return (
                  <label
                    key={option.value}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
                      isLoaded
                        ? "cursor-default border-[var(--surface0)] bg-[var(--base)] opacity-70"
                        : isSelected
                        ? "border-[var(--tv-accent)] bg-[var(--tv-accent)]/10"
                        : "cursor-pointer border-[var(--surface0)] bg-[var(--base)] hover:border-[var(--surface1)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected && !isLoaded}
                      onChange={() => toggleQuality(option.value)}
                      disabled={loading || isLoaded}
                      className="size-4 accent-[var(--tv-accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[0.78rem] font-semibold text-[var(--text)]">
                          {option.label}
                        </span>
                        {isLoaded && (
                          <Badge variant="secondary" className="border-0 bg-[var(--green)]/15 px-1.5 py-0 text-[0.5rem] text-[var(--green)]">
                            loaded
                          </Badge>
                        )}
                        {!isLoaded && isCached && (
                          <Badge variant="secondary" className="border-0 bg-[var(--green)]/15 px-1.5 py-0 text-[0.5rem] text-[var(--green)]">
                            cached
                          </Badge>
                        )}
                      </div>
                      <div className="text-[0.6rem] text-[var(--overlay)]">
                        {option.description}
                      </div>
                    </div>
                    <span className="font-mono text-[0.6rem] text-[var(--overlay)]">
                      {isLoaded
                        ? "ready"
                        : cacheReadyLabel(option.value)
                          ? "cached"
                          : `~${rowSize} MB`}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {loading && (
            <div className="space-y-1.5">
              <Progress value={codec.progress} className="h-1.5" />
              <div className="font-mono text-[0.65rem] text-[var(--overlay)]">
                {codec.statusText}
              </div>
            </div>
          )}

          {codec.errorText && codec.state === "error" && (
            <p className="text-[0.7rem] text-[var(--red)]">{codec.errorText}</p>
          )}
        </div>

        <DialogFooter>
          {loading ? (
            <Button variant="outline" onClick={codec.abortLoading}>
              Cancel download
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {multiSelect && (
                <Button onClick={() => handleDownload(selected)} disabled={selected.length === 0}>
                  {selected.length === 0
                    ? "Select a quality"
                    : selectedSize === 0
                      ? "Load selected from cache"
                      : `Download selected (~${selectedSize} MB)`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
