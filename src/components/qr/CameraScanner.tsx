import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useCamera } from "@/hooks/useCamera";
import { useQRScanner } from "@/hooks/useQRScanner";
import CameraIcon from "@/components/ui/camera-icon";

interface CameraScannerProps {
  onQRData: (data: string) => void;
}

export default function CameraScanner({ onQRData }: CameraScannerProps) {
  const { isActive, status, videoRef, toggle, stop } = useCamera();

  const handleScan = useCallback(
    (data: string) => {
      stop();
      onQRData(data);
    },
    [stop, onQRData],
  );

  useQRScanner({
    videoRef,
    isActive,
    onScan: handleScan,
    intervalMs: 250,
  });

  return (
    <div className="text-center">
      {isActive && (
        <div className="relative mb-3 overflow-hidden rounded-xl bg-[var(--base)]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="block w-full rounded-xl"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-xl border-2 border-[var(--tv-accent)] opacity-40" />
          </div>
        </div>
      )}
      {status && (
        <p className="mb-2 text-[0.7rem] text-[var(--overlay)]">{status}</p>
      )}
      <Button
        variant={isActive ? "destructive" : "secondary"}
        size="sm"
        onClick={toggle}
      >
        {isActive ? (
          <>
            <CameraIcon size={14} />
            Stop Camera
          </>
        ) : (
          <>
            <CameraIcon size={14} />
            Start Camera
          </>
        )}
      </Button>
    </div>
  );
}
