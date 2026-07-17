import { useEffect, useRef, useState, useCallback } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { codec } from "@/lib/codec-service";
import { Quality } from "@/types/codec";
import { SR } from "@/lib/constants";
import { bytesToBase64 } from "@/lib/qrParsing";
import { autoDecoderLabel } from "@/lib/format";
import { unpackTokens } from "@/lib/wire-format";
import { Loader2, Play, Square } from "lucide-react";
import CopyIcon from "@/components/ui/copy-icon";
import DownloadIcon from "@/components/ui/download-icon";
import CodeIcon from "@/components/ui/code-icon";
import { HexStream } from "@/components/audio/HexStream";
import { formatHexBytes } from "@/lib/hex";

const DECODER_OPTS: { label: string; value: string }[] = [
  { label: "Auto", value: "auto" },
  { label: "12.5hz", value: Quality.Hz12_5 },
  { label: "25hz", value: Quality.Hz25 },
  { label: "50hz", value: Quality.Hz50 },
];

interface QRResultProps {
  packed: Uint8Array;
  duration: number;
  onHexOpen?: () => void;
}

export default function QRResult({
  packed,
  duration,
  onHexOpen,
}: QRResultProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [hexCopyState, setHexCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [playing, setPlaying] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewStatus, setPreviewStatus] = useState("");
  const [decoderOverride, setDecoderOverride] = useState<Quality | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const playbackGenerationRef = useRef(0);

  const b64 = bytesToBase64(packed);
  const playUrl = `${window.location.origin}/qr?v=${encodeURIComponent(b64)}`;
  const parsedPacket = unpackTokens(packed);
  const autoLabel = parsedPacket
    ? autoDecoderLabel(parsedPacket.quality, parsedPacket.hasMagicByte)
    : "Auto";

  const stopPlayback = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;
    sourceRef.current = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // The source may already have ended.
    }
    source.disconnect();
  }, []);

  useEffect(() => {
    playbackGenerationRef.current += 1;
    stopPlayback();
    audioBufferRef.current = null;
    setPlaying(false);
    setPreviewLoading(false);
    setPreviewProgress(0);
    setPreviewStatus("");
    setDecoderOverride(null);
    setCopied(false);
    setHexCopyState("idle");

    return () => {
      playbackGenerationRef.current += 1;
      stopPlayback();
    };
  }, [packed, stopPlayback]);

  useEffect(() => {
    return () => {
      const context = audioCtxRef.current;
      audioCtxRef.current = null;
      if (context && context.state !== "closed") void context.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(playUrl, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [playUrl]);

  const copyUrl = useCallback(async () => {
    await navigator.clipboard.writeText(playUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [playUrl]);

  const copyHex = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatHexBytes(packed));
      setHexCopyState("copied");
    } catch {
      setHexCopyState("error");
    }
    setTimeout(() => setHexCopyState("idle"), 1500);
  }, [packed]);

  const downloadQR = useCallback(() => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "tinyvoice-qr.png";
    a.click();
  }, [qrDataUrl]);

  const handleDecoderChange = useCallback((value: string) => {
    const q = value === "auto" ? null : (value as Quality);
    playbackGenerationRef.current += 1;
    stopPlayback();
    setDecoderOverride(q);
    audioBufferRef.current = null;
    setPlaying(false);
    setPreviewLoading(false);
    setPreviewProgress(0);
    setPreviewStatus("");
  }, [stopPlayback]);

  const preview = useCallback(async () => {
    if (previewLoading) return;
    if (sourceRef.current) {
      playbackGenerationRef.current += 1;
      stopPlayback();
      setPlaying(false);
      return;
    }

    const generation = ++playbackGenerationRef.current;
    const isCurrent = () => playbackGenerationRef.current === generation;
    const cachedBuffer = audioBufferRef.current;

    try {
      if (cachedBuffer) {
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          audioCtxRef.current = new AudioContext({ sampleRate: SR });
        }
        if (audioCtxRef.current.state === "suspended") {
          await audioCtxRef.current.resume();
        }
        if (!isCurrent()) return;

        const src = audioCtxRef.current.createBufferSource();
        src.buffer = cachedBuffer;
        src.connect(audioCtxRef.current.destination);
        sourceRef.current = src;
        setPlaying(true);
        src.onended = () => {
          src.disconnect();
          if (!isCurrent() || sourceRef.current !== src) return;
          sourceRef.current = null;
          setPlaying(false);
        };
        src.start();
        return;
      }

      setPreviewStatus("Decoding...");
      setPreviewProgress(0);
      setPreviewLoading(true);
      const audio = await codec.decode(
        packed,
        decoderOverride ?? undefined,
        (info) => {
          if (!isCurrent()) return;
          setPreviewProgress(info.fraction * 100);
          setPreviewStatus(info.status);
        },
      );
      if (!isCurrent()) return;

      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext({ sampleRate: SR });
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      if (!isCurrent()) return;

      const buf = audioCtxRef.current.createBuffer(1, audio.length, SR);
      buf.getChannelData(0).set(audio);
      audioBufferRef.current = buf;

      const src = audioCtxRef.current.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtxRef.current.destination);
      sourceRef.current = src;
      setPlaying(true);
      setPreviewStatus("");
      setPreviewProgress(0);
      setPreviewLoading(false);
      src.onended = () => {
        src.disconnect();
        if (!isCurrent() || sourceRef.current !== src) return;
        sourceRef.current = null;
        setPlaying(false);
      };
      src.start();
    } catch (e) {
      if (!isCurrent()) return;
      stopPlayback();
      setPreviewStatus((e as Error).message);
      setPreviewProgress(0);
      setPlaying(false);
      setPreviewLoading(false);
    }
  }, [
    packed,
    playing,
    decoderOverride,
    previewLoading,
    stopPlayback,
  ]);

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
          <b className="font-semibold text-[var(--text)]">{(packed.length - 1) / 2}</b>{" "}
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
          disabled={previewLoading}
        >
          {previewLoading ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              Loading...
            </>
          ) : playing ? (
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
          <CopyIcon size={12} />
          {copied ? "Copied!" : "Copy URL"}
        </Button>

        <Button variant="outline" size="sm" onClick={copyHex}>
          <CopyIcon size={12} />
          {hexCopyState === "copied"
            ? "Hex copied!"
            : hexCopyState === "error"
              ? "Copy failed"
              : "Copy hex"}
        </Button>

        <Button variant="outline" size="sm" onClick={downloadQR}>
          <DownloadIcon size={12} />
          Download
        </Button>

        {onHexOpen && (
          <Button variant="outline" size="sm" onClick={onHexOpen}>
            <CodeIcon size={12} />
            Hex
          </Button>
        )}
      </div>

      <HexStream
        data={packed}
        active={playing}
        duration={audioBufferRef.current?.duration ?? duration}
        label="Token data"
        className="w-full"
      />

      {/* Decoder override */}
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className="mr-1 text-[0.6rem] text-[var(--overlay)]">
          Decoder:
        </span>
        {DECODER_OPTS.map((opt) => (
          <Button
            key={opt.value}
            variant="ghost"
            size="sm"
            className={`h-6 px-2 font-sans text-[0.6rem] ${
              (opt.value === "auto" && !decoderOverride) ||
              opt.value === decoderOverride
                ? "bg-[var(--surface0)] font-semibold text-[var(--text)]"
                : "text-[var(--overlay)]"
            }`}
            onClick={() => handleDecoderChange(opt.value)}
          >
            {opt.value === "auto" ? autoLabel : opt.label}
          </Button>
        ))}
      </div>

      {previewLoading && (
        <Progress value={previewProgress} className="h-1.5 w-full max-w-[260px]" />
      )}

      {previewStatus && (
        <p className="text-xs text-[var(--overlay)]">{previewStatus}</p>
      )}
    </div>
  );
}
