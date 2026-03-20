import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { fmt } from "@/lib/format";

interface Stats {
  bytesSent: string;
  bytesRecv: string;
  encodeTime: string;
  decodeTime: string;
  totalSent: number;
  totalRecv: number;
  userCount: number;
}

interface StatsContextValue extends Stats {
  addSent: (bytes: number) => void;
  addRecv: (bytes: number) => void;
  setEncodeTime: (seconds: number) => void;
  setDecodeTime: (seconds: number) => void;
  setLastSent: (bytes: number) => void;
  setLastRecv: (bytes: number) => void;
  setUserCount: (count: number) => void;
}

const StatsContext = createContext<StatsContextValue | null>(null);

export function StatsProvider({ children }: { children: ReactNode }) {
  const [bytesSent, setBytesSentStr] = useState("\u2014");
  const [bytesRecv, setBytesRecvStr] = useState("\u2014");
  const [encodeTime, setEncodeTimeStr] = useState("\u2014");
  const [decodeTime, setDecodeTimeStr] = useState("\u2014");
  const [totalSent, setTotalSent] = useState(0);
  const [totalRecv, setTotalRecv] = useState(0);
  const [userCount, setUserCount] = useState(0);

  const addSent = useCallback((bytes: number) => {
    setTotalSent((prev) => prev + bytes);
  }, []);

  const addRecv = useCallback((bytes: number) => {
    setTotalRecv((prev) => prev + bytes);
  }, []);

  const setEncodeTime = useCallback((seconds: number) => {
    setEncodeTimeStr(seconds.toFixed(2) + "s");
  }, []);

  const setDecodeTime = useCallback((seconds: number) => {
    setDecodeTimeStr(seconds.toFixed(1) + "s");
  }, []);

  const setLastSent = useCallback((bytes: number) => {
    setBytesSentStr(fmt(bytes));
  }, []);

  const setLastRecv = useCallback((bytes: number) => {
    setBytesRecvStr(fmt(bytes));
  }, []);

  return (
    <StatsContext.Provider
      value={{
        bytesSent,
        bytesRecv,
        encodeTime,
        decodeTime,
        totalSent,
        totalRecv,
        userCount,
        addSent,
        addRecv,
        setEncodeTime,
        setDecodeTime,
        setLastSent,
        setLastRecv,
        setUserCount,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export function useStats(): StatsContextValue {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error("useStats must be used inside StatsProvider");
  return ctx;
}
