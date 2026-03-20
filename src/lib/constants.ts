/** Sample rate in Hz */
export const SR = 16000;

/** FFT size for STFT/iSTFT */
export const NFFT = 1024;

/** Hop length (samples between successive STFT frames) */
export const HOP = 320;

/** Window length for STFT/iSTFT */
export const WLEN = 1024;

/** Padding samples to trim from iSTFT output */
export const PAD = 352;

/** Base URL for ONNX model downloads on HuggingFace */
export const MODEL_BASE =
  "https://huggingface.co/skymorphosis/focalcodec-onnx/resolve/main/";
