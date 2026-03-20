import { useRef } from "react";
import { useWaveform } from "@/hooks/useWaveform";

interface WaveformCanvasProps {
  analyserNode: AnalyserNode | null;
  active: boolean;
}

export function WaveformCanvas({ analyserNode, active }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useWaveform(canvasRef, analyserNode, active);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={32}
      className="w-40 h-8 rounded-md"
    />
  );
}
