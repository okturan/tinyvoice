import { useState, useCallback } from "react";
import Dropzone from "./Dropzone";
import CameraScanner from "./CameraScanner";
import DecodePlayer from "./DecodePlayer";
import { parseTokenData, type ParsedTokens } from "@/lib/codec";
import { decodeQRString } from "@/lib/qrParsing";

interface DecodePanelProps {
  initialData?: Uint8Array | null;
}

export default function DecodePanel({ initialData }: DecodePanelProps) {
  const [parsed, setParsed] = useState<ParsedTokens | null>(() => {
    if (initialData) {
      return parseTokenData(initialData);
    }
    return null;
  });
  const [error, setError] = useState("");

  const handleTokenData = useCallback((data: Uint8Array) => {
    const result = parseTokenData(data);
    if (!result) {
      setError("Invalid voice data");
      return;
    }
    setError("");
    setParsed(result);
  }, []);

  const handleQRData = useCallback(
    (str: string) => {
      const bytes = decodeQRString(str);
      if (bytes) {
        handleTokenData(bytes);
      } else {
        setError("QR does not contain voice data");
      }
    },
    [handleTokenData],
  );

  const handleError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  return (
    <div>
      <Dropzone onTokenData={handleTokenData} onError={handleError} />

      <div className="my-3 text-center text-[0.65rem] text-[var(--surface2)]">
        &mdash; or scan with camera &mdash;
      </div>

      <CameraScanner onQRData={handleQRData} />

      {error && (
        <p className="mt-3 text-center text-xs text-[var(--red)]">{error}</p>
      )}

      {parsed && <DecodePlayer parsed={parsed} />}
    </div>
  );
}
