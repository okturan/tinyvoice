import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Dropzone from "./Dropzone";
import CameraScanner from "./CameraScanner";
import DecodePlayer from "./DecodePlayer";
import HexInput from "./HexInput";
import { codec, type ParsedPacket } from "@/lib/codec-service";
import { decodeQRString } from "@/lib/qrParsing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLayoutEthos } from "@/contexts/LayoutContext";
import { qualityLabel } from "@/lib/format";

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
  const [packetBytes, setPacketBytes] = useState<Uint8Array | null>(() =>
    initialData ? new Uint8Array(initialData) : null,
  );
  const [error, setError] = useState("");

  const handleTokenData = useCallback((data: Uint8Array) => {
    const result = codec.parsePacket(data);
    if (!result) {
      setError("Invalid voice data");
      setParsed(null);
      setPacketBytes(null);
      return;
    }
    setError("");
    setParsed(result);
    setPacketBytes(new Uint8Array(data));
  }, []);

  const handleHexData = useCallback((data: Uint8Array) => {
    const result = codec.parsePacket(data);
    if (!result) {
      setError("");
      setParsed(null);
      setPacketBytes(null);
      return "These bytes are hexadecimal, but they are not a valid TinyVoice packet.";
    }
    setError("");
    setParsed(result);
    setPacketBytes(new Uint8Array(data));
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

  const clearPacket = useCallback(() => {
    setParsed(null);
    setPacketBytes(null);
    setError("");
  }, []);

  const { ethos } = useLayoutEthos();

  const sources = (
    <Tabs defaultValue="hex" className="min-h-0 flex-shrink-0 gap-2 overflow-hidden">
      <TabsList className="grid w-full flex-shrink-0 grid-cols-3 bg-[var(--mantle)]">
        <TabsTrigger value="hex">Hex</TabsTrigger>
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="camera">Camera</TabsTrigger>
      </TabsList>

      <TabsContent value="hex" className="mt-0 max-h-56 flex-none overflow-y-auto">
        <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
          <CardContent className="px-4 py-3">
            <HexInput
              onTokenData={handleHexData}
              onError={(message) => {
                if (!message) setError("");
              }}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="upload" className="mt-0 max-h-56 flex-none overflow-y-auto">
        <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
          <CardContent className="px-4 py-3">
            <Dropzone onTokenData={handleTokenData} onError={handleError} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="camera" className="mt-0 max-h-56 flex-none overflow-y-auto">
        <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
          <CardContent className="px-4 py-3">
            <CameraScanner onQRData={handleQRData} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );

  const player = parsed && packetBytes && (
    <Card className="border-[var(--surface0)] bg-[var(--mantle)] py-0">
      <CardContent className="px-4 py-3">
        <div className="text-[0.6rem] text-[var(--overlay)] uppercase tracking-widest font-semibold mb-2">
          Player
        </div>
        <DecodePlayer parsed={parsed} packetBytes={packetBytes} />
      </CardContent>
    </Card>
  );

  const errorLine = error && (
    <p className="flex-shrink-0 text-center text-xs text-[var(--red)]">{error}</p>
  );

  if (ethos === "split-deck") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto sm:flex-row sm:overflow-visible">
        {/* Source rail */}
        <div className="flex flex-shrink-0 flex-col gap-2 sm:w-[260px]">
          {sources}
          {errorLine}
        </div>

        {/* Player pane */}
        <div className="min-h-0 flex-1 sm:overflow-y-auto">
          {player || (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed border-[var(--surface0)]">
              <p className="px-6 text-center text-xs text-[var(--overlay)]">
                Load a packet — the player appears here
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Stage swap: a loaded packet takes the whole canvas
  if (parsed && packetBytes) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={clearPacket}>
            ← New source
          </Button>
          <span className="ml-auto font-mono text-[0.65rem] text-[var(--overlay)]">
            {packetBytes.length} B ·{" "}
            <b className="font-semibold text-[var(--green)]">{qualityLabel(parsed.quality)}</b>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{player}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      {sources}
      {errorLine}
    </div>
  );
}
