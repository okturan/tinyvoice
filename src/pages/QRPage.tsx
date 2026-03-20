import { useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RecordPanel from "@/components/qr/RecordPanel";
import DecodePanel from "@/components/qr/DecodePanel";
import { decodeQRString } from "@/lib/qrParsing";

export default function QRPage() {
  const [searchParams] = useSearchParams();
  const voiceB64 = searchParams.get("v");

  const initialData = useMemo(() => {
    if (!voiceB64) return null;
    return decodeQRString(voiceB64);
  }, [voiceB64]);

  const defaultTab = voiceB64 ? "decode" : "record";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-[min(92vw,440px)]">
        <div className="mb-5 text-center">
          <h1 className="text-lg font-bold text-[var(--text)]">
            TinyVoice QR
          </h1>
          <p className="mt-0.5 text-[0.72rem] text-[var(--overlay)]">
            voice messages as QR codes
          </p>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="mb-4 grid w-full grid-cols-2 bg-[var(--mantle)]">
            <TabsTrigger value="record">Record</TabsTrigger>
            <TabsTrigger value="decode">Decode</TabsTrigger>
          </TabsList>

          <div className="rounded-[14px] border border-[var(--surface0)] bg-[var(--base)] p-6">
            <TabsContent value="record" className="mt-0">
              <RecordPanel />
            </TabsContent>

            <TabsContent value="decode" className="mt-0">
              <DecodePanel initialData={initialData} />
            </TabsContent>
          </div>
        </Tabs>

        <Link
          to="/"
          className="mt-4 block text-center text-[0.7rem] text-[var(--overlay)] no-underline hover:text-[var(--tv-accent)]"
        >
          &larr; back to PTT
        </Link>
      </div>
    </div>
  );
}
