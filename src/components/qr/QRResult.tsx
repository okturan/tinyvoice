import { useEffect, useRef, useState, useCallback } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decode } from "@/lib/codec";
import { SR, type Quality } from "@/lib/constants";
import { bytesToBase64 } from "@/lib/qrParsing";

interface QRResultProps {
  packed: Uint8Array;
  tokenCount: number;
  duration: number;
  quality: Quality;
}

export default function QRResult({
  packed,
  tokenCount,
  duration,
  quality,
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
      // Token data is packed with magic byte at index 0 -- skip it for decode
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
    <div className="flex flex-col items-center gap-2.5">
      {qrDataUrl && (
        <img
          src={qrDataUrl}
          alt="QR code"
          width={180}
          height={180}
          className="rounded-lg bg-white p-2"
        />
      )}

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

      <Button
        variant="outline"
        size="sm"
        className={`rounded-full px-5 ${playing ? "border-[var(--green)] text-[var(--green)]" : ""}`}
        onClick={preview}
      >
        {playing ? (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
              className="mr-1"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            Playing...
          </>
        ) : (
          <>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
              className="mr-1"
            >
              <polygon points="6,3 20,12 6,21" />
            </svg>
            Preview
          </>
        )}
      </Button>

      {previewStatus && (
        <p className="text-xs text-[var(--overlay)]">{previewStatus}</p>
      )}

      <div className="flex w-full gap-1">
        <Input
          readOnly
          value={playUrl}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="min-w-0 flex-1 bg-[var(--mantle)] font-mono text-[0.6rem] text-[var(--subtext)]"
        />
        <Button variant="secondary" size="sm" onClick={copyUrl}>
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>

      <div className="flex w-full gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={downloadQR}
        >
          Download QR
        </Button>
      </div>
    </div>
  );
}
