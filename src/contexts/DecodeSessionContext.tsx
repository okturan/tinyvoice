import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { codec, type ParsedPacket } from "@/lib/codec-service";
import { decodeQRString, validateVoicePacket } from "@/lib/qrParsing";
import { Quality } from "@/types/codec";

type PacketSource = "hex" | "upload" | "camera" | "url";

export interface DecodeSession {
  parsed: ParsedPacket | null;
  packetBytes: Uint8Array | null;
  error: string;
  qualityOverride: Quality | null;
  playerStatus: string;
  playerStatusType: "" | "ok" | "err";
  decodedPcm: Float32Array | null;
  hexSubmittedBytes: number | null;
  hexDraft: string;
  setError: (message: string) => void;
  setQualityOverride: (quality: Quality | null) => void;
  setPlayerStatus: (status: string) => void;
  setPlayerStatusType: (type: "" | "ok" | "err") => void;
  setDecodedPcm: (pcm: Float32Array | null) => void;
  setHexSubmittedBytes: (bytes: number | null) => void;
  setHexDraft: (text: string) => void;
  acceptPacket: (bytes: Uint8Array, source: PacketSource) => string | void;
  clearPacket: () => void;
}

const DecodeSessionContext = createContext<DecodeSession | null>(null);

function resetPlayerFields(
  setQualityOverride: (q: Quality | null) => void,
  setPlayerStatus: (s: string) => void,
  setPlayerStatusType: (t: "" | "ok" | "err") => void,
  setDecodedPcm: (p: Float32Array | null) => void,
) {
  setQualityOverride(null);
  setPlayerStatus("");
  setPlayerStatusType("");
  setDecodedPcm(null);
}

function packetFromVoiceB64(voiceB64: string | null): {
  parsed: ParsedPacket | null;
  packetBytes: Uint8Array | null;
  error: string;
} {
  if (!voiceB64) return { parsed: null, packetBytes: null, error: "" };
  const data = decodeQRString(voiceB64);
  if (!data) {
    return {
      parsed: null,
      packetBytes: null,
      error: "This link does not contain voice data",
    };
  }
  const result = codec.parsePacket(data);
  if (!result) {
    return {
      parsed: null,
      packetBytes: null,
      error: "This link does not contain voice data",
    };
  }
  return { parsed: result, packetBytes: new Uint8Array(data), error: "" };
}

export function DecodeSessionProvider({
  voiceB64,
  children,
}: {
  voiceB64: string | null;
  children: ReactNode;
}) {
  const initial = packetFromVoiceB64(voiceB64);
  const [parsed, setParsed] = useState<ParsedPacket | null>(initial.parsed);
  const [packetBytes, setPacketBytes] = useState<Uint8Array | null>(initial.packetBytes);
  const [error, setError] = useState(initial.error);
  const [qualityOverride, setQualityOverride] = useState<Quality | null>(null);
  const [playerStatus, setPlayerStatus] = useState("");
  const [playerStatusType, setPlayerStatusType] = useState<"" | "ok" | "err">("");
  const [decodedPcm, setDecodedPcm] = useState<Float32Array | null>(null);
  const [hexSubmittedBytes, setHexSubmittedBytes] = useState<number | null>(null);
  const [hexDraft, setHexDraft] = useState("");

  const acceptPacket = useCallback((bytes: Uint8Array, source: PacketSource): string | void => {
    const failure = validateVoicePacket(bytes);
    if (failure) {
      if (source === "hex") {
        return failure === "Invalid voice data"
          ? "These bytes are hexadecimal, but they are not a valid TinyVoice packet."
          : failure;
      }
      setError(failure);
      return;
    }
    const result = codec.parsePacket(bytes);
    if (!result) {
      if (source === "hex") {
        return "These bytes are hexadecimal, but they are not a valid TinyVoice packet.";
      }
      setError("Invalid voice data");
      return;
    }
    setError("");
    setParsed(result);
    setPacketBytes(new Uint8Array(bytes));
    resetPlayerFields(setQualityOverride, setPlayerStatus, setPlayerStatusType, setDecodedPcm);
    setHexSubmittedBytes(source === "hex" ? bytes.length : null);
  }, []);

  const clearPacket = useCallback(() => {
    setParsed(null);
    setPacketBytes(null);
    setError("");
    setHexSubmittedBytes(null);
    setHexDraft("");
    resetPlayerFields(setQualityOverride, setPlayerStatus, setPlayerStatusType, setDecodedPcm);
  }, []);

  useEffect(() => {
    const next = packetFromVoiceB64(voiceB64);
    if (!voiceB64) return;
    setParsed(next.parsed);
    setPacketBytes(next.packetBytes);
    setError(next.error);
    setHexSubmittedBytes(null);
    setHexDraft("");
    resetPlayerFields(setQualityOverride, setPlayerStatus, setPlayerStatusType, setDecodedPcm);
  }, [voiceB64]);

  const value = useMemo<DecodeSession>(
    () => ({
      parsed,
      packetBytes,
      error,
      qualityOverride,
      playerStatus,
      playerStatusType,
      decodedPcm,
      hexSubmittedBytes,
      hexDraft,
      setError,
      setQualityOverride,
      setPlayerStatus,
      setPlayerStatusType,
      setDecodedPcm,
      setHexSubmittedBytes,
      setHexDraft,
      acceptPacket,
      clearPacket,
    }),
    [
      parsed,
      packetBytes,
      error,
      qualityOverride,
      playerStatus,
      playerStatusType,
      decodedPcm,
      hexSubmittedBytes,
      hexDraft,
      acceptPacket,
      clearPacket,
    ],
  );

  return (
    <DecodeSessionContext.Provider value={value}>
      {children}
    </DecodeSessionContext.Provider>
  );
}

export function useDecodeSession(): DecodeSession {
  const ctx = useContext(DecodeSessionContext);
  if (!ctx) {
    throw new Error("useDecodeSession must be used within a DecodeSessionProvider");
  }
  return ctx;
}
