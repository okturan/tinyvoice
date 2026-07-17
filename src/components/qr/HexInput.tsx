import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { parseHex } from "@/lib/hex";

interface HexInputProps {
  onTokenData: (data: Uint8Array) => string | void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

export default function HexInput({
  onTokenData,
  onError,
  disabled = false,
}: HexInputProps) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [submittedBytes, setSubmittedBytes] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = () => {
    try {
      const bytes = parseHex(value);
      const validationError = onTokenData(bytes);
      if (validationError) {
        setError(validationError);
        onError?.(validationError);
        return;
      }
      setError("");
      setSubmittedBytes(bytes.length);
      onError?.("");
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Unable to read hexadecimal input.";
      setError(message);
      onError?.(message);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  if (submittedBytes !== null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--surface0)] bg-[var(--base)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="size-2 flex-shrink-0 rounded-full bg-[var(--green)]" />
          <div className="min-w-0 text-left">
            <p className="font-mono text-[0.72rem] font-semibold text-[var(--text)]">
              {submittedBytes} hexadecimal bytes loaded
            </p>
            <p className="truncate text-[0.58rem] text-[var(--overlay)]">
              Loaded in the player
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => {
            setSubmittedBytes(null);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        >
          Edit hex
        </Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-2.5" onSubmit={handleSubmit} noValidate>
      <div className="flex items-baseline justify-between gap-3">
        <Label
          htmlFor={fieldId}
          className="text-[0.7rem] text-[var(--subtext)]"
        >
          Hexadecimal bytes
        </Label>
        <span
          id={hintId}
          className="text-[0.58rem] text-[var(--overlay)]"
        >
          ⌘/Ctrl + Enter to decode
        </span>
      </div>

      <textarea
        ref={textareaRef}
        id={fieldId}
        value={value}
        disabled={disabled}
        rows={4}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="0x54 0x56, 01 af 2c 80"
        aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
        aria-invalid={error ? true : undefined}
        className="h-28 w-full resize-none rounded-lg border border-[var(--surface0)] bg-[var(--base)] px-3 py-2 font-mono text-[0.75rem] leading-relaxed text-[var(--text)] outline-none transition-colors placeholder:text-[var(--overlay)] focus:border-[var(--tv-accent)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--red)]"
        onChange={(event) => {
          setValue(event.target.value);
          if (error) {
            setError("");
            onError?.("");
          }
        }}
        onKeyDown={handleKeyDown}
      />

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[var(--red)]"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="sm"
        disabled={disabled}
        className="self-start"
      >
        Decode hex
      </Button>
    </form>
  );
}
