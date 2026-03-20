import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { areCached } from "@/lib/model-cache";
import { QUALITY_OPTIONS } from "@/lib/constants";
import { Quality } from "@/types/codec";
import { useEffect, useState } from "react";

interface QualityPickerProps {
  value: Quality;
  onChange: (quality: Quality) => void;
  /** Bump to trigger a cache re-check (e.g. after model download) */
  refreshKey?: number;
}

export default function QualityPicker({ value, onChange, refreshKey = 0 }: QualityPickerProps) {
  const [cacheState, setCacheState] = useState<
    Record<Quality, boolean | undefined>
  >({
    [Quality.Hz50]: undefined,
    [Quality.Hz25]: undefined,
    [Quality.Hz12_5]: undefined,
  });

  useEffect(() => {
    const keys = QUALITY_OPTIONS.map((q) => `compressor_${q.value}.onnx`);
    areCached(keys).then((results) => {
      const state: Record<string, boolean> = {};
      for (const q of QUALITY_OPTIONS) {
        state[q.value] = results[`compressor_${q.value}.onnx`] ?? false;
      }
      setCacheState(state as Record<Quality, boolean>);
    });
  }, [refreshKey]);

  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as Quality)}
      className="flex gap-1 rounded-lg bg-[var(--mantle)] p-0.5"
    >
      {QUALITY_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={`flex flex-1 cursor-pointer flex-col items-center rounded-md px-1 py-1.5 text-center transition-all ${
            value === opt.value
              ? "bg-[var(--surface0)] text-[var(--text)]"
              : "text-[var(--overlay)] hover:bg-[var(--surface0)]"
          }`}
        >
          <RadioGroupItem value={opt.value} className="sr-only" />
          <span className="text-xs font-semibold">
            {opt.label}{" "}
            <span
              className={`text-[0.55rem] ${
                cacheState[opt.value as Quality]
                  ? "text-[var(--green)]"
                  : "text-[var(--surface2)]"
              }`}
            >
              {cacheState[opt.value as Quality] === undefined
                ? ""
                : cacheState[opt.value as Quality]
                  ? "\u2713"
                  : "\u2193"}
            </span>
          </span>
          <span
            className={`mt-px text-[0.5rem] transition-colors ${
              value === opt.value
                ? "text-[var(--subtext)]"
                : "text-[var(--surface2)]"
            }`}
          >
            {opt.description}
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}
