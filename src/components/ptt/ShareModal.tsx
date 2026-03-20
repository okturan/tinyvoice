import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  bytes: number;
  tokens: number;
  duration: string;
}

export function ShareModal({
  open,
  onOpenChange,
  url,
  bytes,
  tokens,
  duration,
}: ShareModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 200,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      }).catch(console.error);
    }
  }, [open, url]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--base)] border-[var(--surface0)] rounded-2xl max-w-[360px] text-center p-6">
        <DialogHeader>
          <DialogTitle className="text-[0.9rem] font-semibold text-[var(--text)]">
            Voice Message
          </DialogTitle>
        </DialogHeader>

        <div className="flex justify-center my-4">
          <canvas
            ref={canvasRef}
            className="rounded-lg bg-white p-2"
          />
        </div>

        <div className="flex justify-center gap-4 font-mono text-[0.7rem] text-[var(--overlay)] mb-3">
          <span>
            <b className="text-[var(--text)] font-semibold">{bytes}</b> bytes
          </span>
          <span>
            <b className="text-[var(--text)] font-semibold">{tokens}</b> tokens
          </span>
          <span>
            <b className="text-[var(--text)] font-semibold">{duration}</b>s
          </span>
        </div>

        <div className="flex gap-1">
          <input
            readOnly
            value={url}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="flex-1 min-w-0 px-2.5 py-1.5 bg-[var(--mantle)] border border-[var(--surface0)] rounded-[7px] text-[var(--subtext)] font-mono text-[0.65rem] cursor-pointer outline-none focus:border-[var(--surface1)]"
          />
          <Button
            variant="secondary"
            size="sm"
            className="text-[0.72rem] whitespace-nowrap"
            onClick={handleCopy}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>

        <p className="mt-3 text-[0.65rem] text-[var(--overlay)]">
          Scan QR or share the link {"\u2014"} recipient decodes in browser
        </p>
      </DialogContent>
    </Dialog>
  );
}
