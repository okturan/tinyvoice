import { useEffect, useRef, useState, useCallback } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { decode } from "@/lib/codec";
import { SR, type Quality } from "@/lib/constants";
import { bytesToBase64 } from "@/lib/qrParsing";
import { Copy, Download, Play, Square, Code } from "lucide-react";

interface QRResultProps {
  packed: Uint8Array;
  tokenCount: number;
  duration: number;
  quality: Quality;
  onHexOpen?: () => void;
}

export default function QRResult({
  packed,
  tokenCount,
  duration,
  quality,
  onHexOpen,
}: QRResultProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("");
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const b64 = bytesToBase64(packed);
  const playUrl = `${window.location.origin}/qr?v=${encodeURIComponent(b64)}`;

  useEffect(() => {
    QRCode.toDataURL(playUrl, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [playUrl]);

  const copyUrl = useCallback(async () => {
    await navigator.clipboard.writeText(playUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [playUrl]);

  const downloadQR = useCallback(() => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "tinyvoice-qr.png";
    a.click();
  }, [qrDataUrl]);

  const preview = useCallback(async () => {
    if (playing && sourceRef.current) {
      sourceRef.current.stop();
      sourceRef.current = null;
      setPlaying(false);
      return;
    }

    setPreviewStatus("Decoding...");
    try {
      const tokens = packed.slice(1);
      const audio = await decode(tokens, tokenCount, quality, {
        onProgress: () => {},
        onStatus: setPreviewStatus,
      });

      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext({ sampleRate: SR });
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }

      const buf = audioCtxRef.current.createBuffer(1, audio.length, SR);
      buf.getChannelData(0).set(audio);
      const src = audioCtxRef.current.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtxRef.current.destination);
      sourceRef.current = src;
      setPlaying(true);
      setPreviewStatus("");
      src.onended = () => {
        setPlaying(false);
        sourceRef.current = null;
      };
      src.start();
    } catch (e) {
      setPreviewStatus((e as Error).message);
    }
  }, [packed, quality, tokenCount, playing]);

  return (
    <div className="flex flex-col items-center gap-3">
      {qrDataUrl && (
        <img
          src={qrDataUrl}
          alt="QR code"
          width={180}
          height={180}
          className="rounded-lg bg-white p-2"
        />
      )}

      {/* Metadata */}
      <div className="flex gap-4 font-mono text-[0.68rem] text-[var(--overlay)]">
        <span>
          <b className="font-semibold text-[var(--text)]">{packed.length}</b>{" "}
          bytes
        </span>
        <span>
          <b className="font-semibold text-[var(--text)]">{tokenCount}</b>{" "}
          tokens
        </span>
        <span>
          <b className="font-semibold text-[var(--text)]">
            {duration.toFixed(1)}
          </b>
          s
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className={`rounded-full ${playing ? "border-[var(--green)] text-[var(--green)]" : ""}`}
          onClick={preview}
        >
          {playing ? (
            <>
              <Square className="size-3 fill-current" />
              Playing...
            </>
          ) : (
            <>
              <Play className="size-3 fill-current" />
              Preview
            </>
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={copyUrl}>
          <Copy className="size-3" />
          {copied ? "Copied!" : "Copy URL"}
        </Button>

        <Button variant="outline" size="sm" onClick={downloadQR}>
          <Download className="size-3" />
          Download
        </Button>

        {onHexOpen && (
          <Button variant="outline" size="sm" onClick={onHexOpen}>
            <Code className="size-3" />
            Hex
          </Button>
        )}
      </div>

      {previewStatus && (
        <p className="text-xs text-[var(--overlay)]">{previewStatus}</p>
      )}
    </div>
  );
}
