import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useModelCache } from "@/hooks/useModelCache";
import { delCache, clearModelCache } from "@/lib/model-cache";

const KNOWN_MODELS = [
  { name: "encoder.onnx", size: 595 },
  { name: "decoder_50hz.onnx", size: 135 },
  { name: "decoder_25hz.onnx", size: 139 },
  { name: "decoder_12_5hz.onnx", size: 141 },
  { name: "compressor_50hz.onnx", size: 70 },
  { name: "compressor_25hz.onnx", size: 74 },
  { name: "compressor_12_5hz.onnx", size: 76 },
] as const;

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function ModelManagement() {
  const { cachedModels, totalSize, loading, refresh } = useModelCache();

  const cachedKeys = new Set(cachedModels.map((m) => m.key));

  const handleDelete = async (key: string) => {
    await delCache(key);
    refresh();
  };

  const handleClearAll = async () => {
    await clearModelCache();
    refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <Label className="text-[var(--subtext)] text-xs">Models</Label>

      <div className="flex flex-col gap-1.5">
        {KNOWN_MODELS.map((model) => {
          const isCached = cachedKeys.has(model.name);
          const cachedEntry = cachedModels.find((m) => m.key === model.name);

          return (
            <div
              key={model.name}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-[var(--base)]"
            >
              <span className="flex-1 font-mono text-xs text-[var(--text)] truncate">
                {model.name}
              </span>
              <span className="text-[0.6rem] text-[var(--overlay)] tabular-nums">
                {model.size} MB
              </span>
              <Badge
                variant="secondary"
                className={`text-[0.55rem] px-1.5 py-0 ${
                  isCached
                    ? "bg-[color-mix(in_srgb,var(--green)_15%,transparent)] text-[var(--green)] border-0"
                    : "bg-[var(--surface0)] text-[var(--overlay)] border-0"
                }`}
              >
                {isCached ? "cached" : "not cached"}
              </Badge>
              {isCached && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] min-w-[44px] p-0 text-[var(--overlay)] hover:text-[var(--red)]"
                  onClick={() => handleDelete(model.name)}
                  title={`Delete ${model.name} (${cachedEntry ? formatSize(cachedEntry.size) : ""})`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Total + Clear All */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[0.65rem] text-[var(--overlay)]">
          {loading ? "Checking..." : `Total cached: ${formatSize(totalSize)}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-[0.65rem] text-[var(--overlay)] hover:text-[var(--red)] min-h-[44px]"
          onClick={handleClearAll}
          disabled={totalSize === 0}
        >
          Clear All
        </Button>
      </div>
    </div>
  );
}
