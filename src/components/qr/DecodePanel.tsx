import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Dropzone from "./Dropzone";
import CameraScanner from "./CameraScanner";
import DecodePlayer from "./DecodePlayer";
import HexInput from "./HexInput";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLayoutEthos } from "@/contexts/LayoutContext";
import { useDecodeSession } from "@/contexts/DecodeSessionContext";
import { decodeQRString } from "@/lib/qrParsing";
import { qualityLabel } from "@/lib/format";

export default function DecodePanel() {
  const {
    parsed,
    packetBytes,
    error,
    hexSubmittedBytes,
    hexDraft,
    setError,
    setHexSubmittedBytes,
    setHexDraft,
    acceptPacket,
    clearPacket,
  } = useDecodeSession();

  const handleTokenData = useCallback(
    (data: Uint8Array) => {
      acceptPacket(data, "upload");
    },
    [acceptPacket],
  );

  const handleHexData = useCallback(
    (data: Uint8Array) => acceptPacket(data, "hex"),
    [acceptPacket],
  );

  const handleQRData = useCallback(
    (str: string) => {
      const bytes = decodeQRString(str);
      if (bytes) {
        acceptPacket(bytes, "camera");
      } else {
        setError("QR does not contain voice data");
      }
    },
    [acceptPacket, setError],
  );

  const handleError = useCallback((msg: string) => {
    setError(msg);
  }, [setError]);

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
              initialSubmittedBytes={hexSubmittedBytes}
              onTokenData={handleHexData}
              onSubmittedChange={setHexSubmittedBytes}
              draft={hexDraft}
              onDraftChange={setHexDraft}
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
        <div className="flex flex-shrink-0 flex-col gap-2 sm:w-[260px]">
          {sources}
          {errorLine}
        </div>

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
