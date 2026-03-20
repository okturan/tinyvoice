import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import Dropzone from "./Dropzone";
import CameraScanner from "./CameraScanner";
import DecodePlayer from "./DecodePlayer";
import { codec, type ParsedPacket } from "@/lib/codec-service";
import { decodeQRString } from "@/lib/qrParsing";

interface DecodePanelProps {
  initialData?: Uint8Array | null;
}

export default function DecodePanel({ initialData }: DecodePanelProps) {
  const [parsed, setParsed] = useState<ParsedPacket | null>(() => {
    if (initialData) {
      return codec.parsePacket(initialData);
    }
    return null;
  });
  const [error, setError] = useState("");

  const handleTokenData = useCallback((data: Uint8Array) => {
    const result = codec.parsePacket(data);
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
    <div className="flex flex-col gap-4">
      {/* Dropzone Card */}
      <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
        <CardContent className="py-4 px-4">
          <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
            Drop or Upload
          </div>
          <Dropzone onTokenData={handleTokenData} onError={handleError} />
        </CardContent>
      </Card>

      {/* Camera Scanner Card */}
      <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
        <CardContent className="py-4 px-4">
          <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
            Camera Scanner
          </div>
          <CameraScanner onQRData={handleQRData} />
        </CardContent>
      </Card>

      {error && (
        <p className="text-center text-xs text-[var(--red)]">{error}</p>
      )}

      {/* Player Card */}
      {parsed && (
        <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
          <CardContent className="py-4 px-4">
            <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
              Player
            </div>
            <DecodePlayer parsed={parsed} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
