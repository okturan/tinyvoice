import { useState, useRef, useCallback, useEffect } from "react";

export function useCamera() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startingRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    return () => {
      el.srcObject = null;
    };
  }, [stream, isActive]);

  const start = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    try {
      setStatus("Requesting camera...");
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (!aliveRef.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = next;
      setStream(next);
      setIsActive(true);
      setStatus("Point at QR code");
    } catch (e) {
      setStatus(`Camera: ${(e as Error).message}`);
    } finally {
      startingRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    setIsActive(false);
    setStatus("");
  }, []);

  const toggle = useCallback(() => {
    if (isActive) {
      stop();
    } else {
      start();
    }
  }, [isActive, start, stop]);

  useEffect(() => {
    return () => {
      aliveRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return { isActive, status, videoRef, toggle, stop };
}
