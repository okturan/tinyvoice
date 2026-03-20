/** Codec quality levels supported by FocalCodec */
export enum Quality {
  /** 50 Hz token rate — best quality, largest payload */
  Hz50 = "50hz",
  /** 25 Hz token rate — balanced */
  Hz25 = "25hz",
  /** 12.5 Hz token rate — smallest payload, fits in QR */
  Hz12_5 = "12_5hz",
}

/** Magic byte values for the wire format header */
export const MAGIC_BYTES: Record<Quality, number> = {
  [Quality.Hz50]: 0x01,
  [Quality.Hz25]: 0x02,
  [Quality.Hz12_5]: 0x03,
};

/** Reverse lookup: magic byte -> quality */
export const MAGIC_TO_QUALITY: Record<number, Quality> = {
  0x01: Quality.Hz50,
  0x02: Quality.Hz25,
  0x03: Quality.Hz12_5,
};

/** Token rates per quality (tokens per second of audio) */
export const QUALITY_RATES: Record<Quality, number> = {
  [Quality.Hz50]: 50,
  [Quality.Hz25]: 25,
  [Quality.Hz12_5]: 12.5,
};

/** ONNX inference sessions for a given quality pipeline */
export interface ModelSessions {
  encoder: ort.InferenceSession | null;
  compressor: Partial<Record<Quality, ort.InferenceSession>>;
  decoder: Partial<Record<Quality, ort.InferenceSession>>;
}

/** Parsed wire-format packet */
export interface WirePacket {
  /** Detected quality from magic byte (or guessed from token count) */
  quality: Quality;
  /** Raw token bytes (without magic byte header) */
  tokenBytes: Uint8Array;
  /** Whether the quality was auto-detected from magic byte vs guessed */
  hasMagicByte: boolean;
}
