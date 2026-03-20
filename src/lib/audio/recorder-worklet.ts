/**
 * AudioWorklet processor code for recording.
 * Replaces deprecated ScriptProcessorNode.
 *
 * Loaded inline via Blob URL to avoid a separate file dependency.
 */
export const RECORDER_WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => {
      if (e.data.type === 'start') this.recording = true;
      if (e.data.type === 'stop') this.recording = false;
    };
  }
  process(inputs) {
    if (this.recording && inputs[0] && inputs[0][0]) {
      const samples = new Float32Array(inputs[0][0]);
      this.port.postMessage({ type: 'samples', data: samples }, [samples.buffer]);
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

let workletBlobUrl: string | null = null;

/** Get a Blob URL for the recorder worklet code. Memoized. */
export function getWorkletUrl(): string {
  if (!workletBlobUrl) {
    const blob = new Blob([RECORDER_WORKLET_CODE], {
      type: "application/javascript",
    });
    workletBlobUrl = URL.createObjectURL(blob);
  }
  return workletBlobUrl;
}
