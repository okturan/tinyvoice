import { useEffect, useRef } from "react";

/**
 * Draws a real-time waveform on a canvas from an AnalyserNode.
 * Uses requestAnimationFrame for smooth rendering.
 */
export function useWaveform(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  analyserNode: AnalyserNode | null,
  active: boolean
) {
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserNode || !active) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufLen = analyserNode.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);

    function draw() {
      if (!active) return;
      rafRef.current = requestAnimationFrame(draw);
      analyserNode!.getByteTimeDomainData(dataArr);

      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineWidth = 1.5;

      const style = getComputedStyle(document.documentElement);
      ctx!.strokeStyle = style.getPropertyValue("--red").trim() || "#f38ba8";

      ctx!.beginPath();
      const sliceW = w / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = dataArr[i] / 128.0;
        const y = v * (h / 2);
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
        x += sliceW;
      }
      ctx!.stroke();
    }

    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [canvasRef, analyserNode, active]);
}
