import { useState, useCallback, useRef } from "react";
import { FolderOpen } from "lucide-react";
import jsQR from "jsqr";
import { decodeQRString } from "@/lib/qrParsing";

interface DropzoneProps {
  onTokenData: (data: Uint8Array) => void;
  onError: (msg: string) => void;
}

export default function Dropzone({ onTokenData, onError }: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (file.type.startsWith("image/")) {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = img.width;
          cv.height = img.height;
          const ctx = cv.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, cv.width, cv.height);
          const qr = jsQR(imageData.data, cv.width, cv.height);
          if (qr) {
            const bytes = decodeQRString(qr.data);
            if (bytes) {
              onTokenData(bytes);
            } else {
              onError("QR does not contain voice data");
            }
          } else {
            onError("No QR found in image");
          }
        };
        img.src = URL.createObjectURL(file);
        return;
      }
      // Binary file
      const reader = new FileReader();
      reader.onload = () => {
        onTokenData(new Uint8Array(reader.result as ArrayBuffer));
      };
      reader.readAsArrayBuffer(file);
    },
    [onTokenData, onError],
  );

  return (
    <>
      <div
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-all ${
          dragOver
            ? "border-[var(--tv-accent)] bg-[color-mix(in_srgb,var(--tv-accent)_5%,var(--base))]"
            : "border-[var(--surface1)] hover:border-[var(--tv-accent)] hover:bg-[color-mix(in_srgb,var(--tv-accent)_5%,var(--base))]"
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <FolderOpen className="mx-auto mb-1.5 h-7 w-7 text-[var(--overlay)]" />
        <div className="text-[0.78rem] text-[var(--subtext)]">
          Drop QR image, .bin, or raw bytes
        </div>
        <div className="mt-1 text-[0.62rem] text-[var(--overlay)]">
          click to browse files
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="*/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
