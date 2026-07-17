/** Persisted microphone preferences, read fresh at record time. */

const GAIN_KEY = "tinyvoice-mic-gain";
const DEVICE_KEY = "tinyvoice-mic-device";
const TRIM_KEY = "tinyvoice-trim-silence";

export const MIC_GAIN_MIN = 0.5;
export const MIC_GAIN_MAX = 3;

export function getMicGain(): number {
  try {
    const raw = Number(localStorage.getItem(GAIN_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(MIC_GAIN_MAX, Math.max(MIC_GAIN_MIN, raw));
  } catch {
    return 1;
  }
}

export function setMicGain(gain: number): void {
  try {
    localStorage.setItem(GAIN_KEY, String(gain));
  } catch {
    // Persistence is best-effort.
  }
}

export function getMicDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function setMicDeviceId(deviceId: string | null): void {
  try {
    if (deviceId) localStorage.setItem(DEVICE_KEY, deviceId);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Persistence is best-effort.
  }
}

/** Trimming the pre-speech dead silence defaults to on. */
export function getTrimSilence(): boolean {
  try {
    return localStorage.getItem(TRIM_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setTrimSilence(enabled: boolean): void {
  try {
    localStorage.setItem(TRIM_KEY, enabled ? "1" : "0");
  } catch {
    // Persistence is best-effort.
  }
}
