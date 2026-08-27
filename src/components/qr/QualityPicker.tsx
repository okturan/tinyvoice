import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCodecContext } from "@/contexts/CodecContext";
import { QUALITY_OPTIONS } from "@/lib/constants";
import { Quality } from "@/types/codec";

interface QualityPickerProps {
  value: Quality;
  onChange: (quality: Quality) => void;
  /** Unused: cache marks now follow the shared context record. */
  refreshKey?: number;
  /** Stack options vertically (for narrow rail layouts) */
  vertical?: boolean;
  disabled?: boolean;
}

export default function QualityPicker({ value, onChange, vertical = false, disabled = false }: QualityPickerProps) {
  const { isCachedForRecording, cacheReady } = useCodecContext();

  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as Quality)}
      disabled={disabled}
      className={`flex gap-1 rounded-lg bg-[var(--mantle)] p-0.5 ${vertical ? "flex-col" : ""}`}
    >
      {QUALITY_OPTIONS.map((opt) => {
        const cached = cacheReady && isCachedForRecording(opt.value);
        return (
          <label
            key={opt.value}
            className={`flex flex-1 flex-col items-center rounded-md px-1 py-1.5 text-center transition-all ${
              disabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            } ${
              value === opt.value
                ? "bg-[var(--surface0)] text-[var(--text)]"
                : disabled
                  ? "text-[var(--overlay)]"
                  : "text-[var(--overlay)] hover:bg-[var(--surface0)]"
            }`}
          >
            <RadioGroupItem value={opt.value} className="sr-only" disabled={disabled} />
            <span className="text-xs font-semibold">
              {opt.label}{" "}
              <span
                className={`text-[0.55rem] ${
                  cached ? "text-[var(--green)]" : "text-[var(--surface2)]"
                }`}
              >
                {cacheReady ? (cached ? "\u2713" : "\u2193") : ""}
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
        );
      })}
    </RadioGroup>
  );
}
