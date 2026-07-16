import TrashIcon from "@/components/ui/trash-icon";
import { Badge } from "@/components/ui/badge";
import { useCodecContext } from "@/contexts/CodecContext";
import { useModelCache } from "@/hooks/useModelCache";
import { delCache } from "@/lib/model-cache";

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
    explanation: "Highest fidelity. 100 payload bytes/s plus one packet header byte.",
    models: [
      { name: "compressor_50hz.onnx", size: 70, desc: "Compressor" },
      { name: "decoder_50hz.onnx", size: 135, desc: "Decoder" },
    ],
  },
  {
    label: "25hz — balanced",
    explanation: "Good quality at half the size: 50 payload bytes/s plus one header byte.",
    models: [
      { name: "compressor_25hz.onnx", size: 74, desc: "Compressor" },
      { name: "decoder_25hz.onnx", size: 139, desc: "Decoder" },
    ],
  },
  {
    label: "12.5hz — smallest",
    explanation: "QR default. 25 payload bytes/s plus one packet header byte.",
    models: [
      { name: "compressor_12_5hz.onnx", size: 76, desc: "Compressor" },
      { name: "decoder_12_5hz.onnx", size: 141, desc: "Decoder" },
    ],
  },
];

const ALL_MODELS = MODEL_GROUPS.flatMap((g) => g.models);

export function ModelManagement() {
  const codec = useCodecContext();
  const { cachedKeys, loading, refresh } = useModelCache();

  const totalCachedMB = ALL_MODELS
    .filter((m) => cachedKeys.has(m.name))
    .reduce((sum, m) => sum + m.size, 0);

  const handleDelete = async (key: string) => {
    await delCache(key);
    refresh();
  };

  const handleClearAll = async () => {
    await codec.clearModelCache();
    refresh();
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

                return (
                  <div key={model.name} className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-[var(--base)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[0.7rem] text-[var(--text)] truncate">{model.name}</span>
                        <span className="text-[0.55rem] text-[var(--overlay)] flex-shrink-0">{model.size} MB</span>
                      </div>
                      <span className="text-[0.55rem] text-[var(--surface2)]">{model.desc}</span>
                    </div>

                    {isCached ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[0.5rem] px-1.5 py-0 bg-[var(--green)]/15 text-[var(--green)] border-0">
                          cached
                        </Badge>
                        <button
                          onClick={() => handleDelete(model.name)}
                          className="p-1 rounded text-[var(--overlay)] hover:text-[var(--red)] transition-colors cursor-pointer"
                          title={`Delete ${model.name}`}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    ) : (
                      <Badge variant="secondary" className="text-[0.5rem] px-1.5 py-0 bg-[var(--surface0)] text-[var(--overlay)] border-0">
                        not cached
                      </Badge>
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
          {loading ? "Checking..." : `Total cached: ~${totalCachedMB} MB`}
        </span>
        <button
          onClick={handleClearAll}
          disabled={cachedKeys.size === 0}
          className="text-[0.6rem] text-[var(--overlay)] hover:text-[var(--red)] disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          title="Delete all downloaded model files from browser storage"
        >
          Delete downloaded models
        </button>
      </div>
    </div>
  );
}
