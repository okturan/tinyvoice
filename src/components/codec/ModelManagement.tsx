import { useState } from "react";
import { Trash2, Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useModelCache } from "@/hooks/useModelCache";
import { delCache, clearModelCache } from "@/lib/model-cache";
import { loadModel } from "@/lib/model-loader";

interface ModelDef {
  name: string;
  size: number;
  desc: string;
}

interface ModelGroup {
  label: string;
  explanation: string;
  models: ModelDef[];
}

const MODEL_GROUPS: ModelGroup[] = [
  {
    label: "Shared encoder",
    explanation: "Required for all recording. Converts audio to neural features.",
    models: [
      { name: "encoder.onnx", size: 595, desc: "WavLM encoder" },
    ],
  },
  {
    label: "50hz — best quality",
    explanation: "Highest fidelity. Larger packets (~576 B per second).",
    models: [
      { name: "compressor_50hz.onnx", size: 70, desc: "Compressor" },
      { name: "decoder_50hz.onnx", size: 135, desc: "Decoder" },
    ],
  },
  {
    label: "25hz — balanced",
    explanation: "Good quality at half the size (~288 B/s). Default for QR.",
    models: [
      { name: "compressor_25hz.onnx", size: 74, desc: "Compressor" },
      { name: "decoder_25hz.onnx", size: 139, desc: "Decoder" },
    ],
  },
  {
    label: "12.5hz — smallest",
    explanation: "Fits in a QR code (~144 B/s). Lower quality.",
    models: [
      { name: "compressor_12_5hz.onnx", size: 76, desc: "Compressor" },
      { name: "decoder_12_5hz.onnx", size: 141, desc: "Decoder" },
    ],
  },
];

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function ModelManagement() {
  const { cachedModels, totalSize, loading, refresh } = useModelCache();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dlProgress, setDlProgress] = useState(0);

  const cachedKeys = new Set(cachedModels.map(m => m.key));

  const handleDelete = async (key: string) => {
    await delCache(key);
    refresh();
  };

  const handleClearAll = async () => {
    await clearModelCache();
    refresh();
  };

  const handleDownload = async (name: string) => {
    if (downloading) return;
    setDownloading(name);
    setDlProgress(0);
    try {
      await loadModel(name, info => setDlProgress(Math.round(info.fraction * 100)));
      refresh();
    } catch {
      // download failed or aborted
    }
    setDownloading(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="text-[0.65rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold">
        Models
      </label>

      {MODEL_GROUPS.map(group => {
        const allCached = group.models.every(m => cachedKeys.has(m.name));
        return (
          <div key={group.label}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[0.7rem] font-semibold text-[var(--text)]">{group.label}</span>
              {allCached && (
                <Badge variant="secondary" className="text-[0.5rem] px-1.5 py-0 bg-[var(--green)]/15 text-[var(--green)] border-0">
                  ready
                </Badge>
              )}
            </div>
            <p className="text-[0.6rem] text-[var(--overlay)] mb-1.5">{group.explanation}</p>

            <div className="flex flex-col gap-1">
              {group.models.map(model => {
                const isCached = cachedKeys.has(model.name);
                const isDownloading = downloading === model.name;

                return (
                  <div key={model.name} className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-[var(--base)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[0.7rem] text-[var(--text)] truncate">{model.name}</span>
                        <span className="text-[0.55rem] text-[var(--overlay)] flex-shrink-0">{model.size} MB</span>
                      </div>
                      <span className="text-[0.55rem] text-[var(--surface2)]">{model.desc}</span>
                    </div>

                    {isDownloading ? (
                      <div className="flex items-center gap-2 min-w-[80px]">
                        <Progress value={dlProgress} className="h-1 flex-1" />
                        <span className="text-[0.5rem] text-[var(--overlay)] tabular-nums w-7 text-right">{dlProgress}%</span>
                      </div>
                    ) : isCached ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[0.5rem] px-1.5 py-0 bg-[var(--green)]/15 text-[var(--green)] border-0">
                          cached
                        </Badge>
                        <button
                          onClick={() => handleDelete(model.name)}
                          className="p-1 rounded text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer"
                          title={`Delete ${model.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDownload(model.name)}
                        disabled={!!downloading}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[0.55rem] font-medium text-[var(--tv-accent)] hover:bg-[var(--tv-accent)]/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        <span>Download</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Total + Clear All */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--surface0)]">
        <span className="text-[0.6rem] text-[var(--overlay)] font-mono">
          {loading ? "Checking..." : `Total cached: ${formatSize(totalSize)}`}
        </span>
        <button
          onClick={handleClearAll}
          disabled={totalSize === 0}
          className="text-[0.6rem] text-[var(--overlay)] hover:text-[var(--red)] disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}
