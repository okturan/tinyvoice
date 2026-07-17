import { useCallback, useEffect, useRef, useState } from "react";
import {
  MIC_GAIN_MAX,
  MIC_GAIN_MIN,
  getMicDeviceId,
  getMicGain,
  setMicDeviceId,
  setMicGain,
} from "@/lib/mic-settings";

/**
 * Microphone preferences: input device, gain, and a live level test.
 * The gain and device are read by the record flow at record time.
 */
export function MicSettings() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => getMicDeviceId() ?? "");
  const [gain, setGainState] = useState<number>(getMicGain);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const peakRef = useRef<HTMLSpanElement | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch {
      // Device listing is best-effort.
    }
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const stopTest = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    gainNodeRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
    setTesting(false);
    if (meterRef.current) meterRef.current.style.width = "0%";
  }, []);

  const startTest = useCallback(async () => {
    setTestError("");
    try {
      const preferred = getMicDeviceId();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          ...(preferred ? { deviceId: { ideal: preferred } } : {}),
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      gainNode.gain.value = getMicGain();
      gainNodeRef.current = gainNode;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(gainNode);
      gainNode.connect(analyser);

      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
        const pct = Math.min(100, peak * 100);
        if (meterRef.current) {
          meterRef.current.style.width = `${pct}%`;
          meterRef.current.style.background =
            peak > 0.95 ? "var(--red)" : "var(--green)";
        }
        if (peakRef.current) {
          peakRef.current.textContent = peak > 0.95 ? "clipping" : `${Math.round(pct)}%`;
        }
      };
      tick();
      setTesting(true);
      // Permission granted → labels become available.
      refreshDevices();
    } catch (e) {
      setTestError((e as Error).message);
      stopTest();
    }
  }, [refreshDevices, stopTest]);

  useEffect(() => stopTest, [stopTest]);

  const handleDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      setMicDeviceId(id || null);
      if (streamRef.current) {
        stopTest();
        void startTest();
      }
    },
    [startTest, stopTest],
  );

  const handleGain = useCallback((value: number) => {
    setGainState(value);
    setMicGain(value);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = value;
  }, []);

  return (
    <div>
      <label className="text-[0.65rem] uppercase tracking-[0.15em] text-[var(--overlay)] font-semibold">
        Microphone
      </label>

      <select
        value={deviceId}
        onChange={(e) => handleDevice(e.target.value)}
        className="mt-1.5 w-full cursor-pointer rounded-md border border-[var(--surface0)] bg-[var(--base)] px-3 py-2 font-mono text-[0.75rem] text-[var(--text)] outline-none transition-colors focus:border-[var(--surface1)]"
      >
        <option value="">System default</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>
      {devices.length > 0 && !devices.some((d) => d.label) && (
        <div className="mt-1 text-[0.6rem] text-[var(--overlay)]">
          Run a mic test to see device names.
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <span className="w-8 flex-shrink-0 text-[0.65rem] text-[var(--overlay)]">Gain</span>
        <input
          type="range"
          min={MIC_GAIN_MIN}
          max={MIC_GAIN_MAX}
          step={0.05}
          value={gain}
          onChange={(e) => handleGain(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer accent-[var(--tv-accent)]"
        />
        <span className="w-10 flex-shrink-0 text-right font-mono text-[0.7rem] tabular-nums text-[var(--subtext)]">
          {Math.round(gain * 100)}%
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={testing ? stopTest : startTest}
          className={`flex-shrink-0 rounded-md border px-3 py-2 text-[0.7rem] font-semibold transition-colors cursor-pointer ${
            testing
              ? "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)] hover:bg-[var(--red)]/20"
              : "border-[var(--surface0)] text-[var(--subtext)] hover:border-[var(--surface1)] hover:text-[var(--text)]"
          }`}
        >
          {testing ? "Stop test" : "Test mic"}
        </button>
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--base)]">
          <div ref={meterRef} className="h-full w-0 rounded-full transition-[width] duration-75" />
        </div>
        <span
          ref={peakRef}
          className="w-14 flex-shrink-0 text-right font-mono text-[0.65rem] tabular-nums text-[var(--overlay)]"
        >
          {testing ? "" : "idle"}
        </span>
      </div>
      {testing && (
        <div className="mt-1 text-[0.6rem] text-[var(--overlay)]">
          Speak normally — the bar shows your level with gain applied.
        </div>
      )}
      {testError && (
        <div className="mt-1 text-[0.6rem] text-[var(--red)]">{testError}</div>
      )}
    </div>
  );
}
