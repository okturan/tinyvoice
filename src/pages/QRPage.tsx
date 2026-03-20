import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TopBar } from "@/components/layout/TopBar";
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
    <div className="min-h-screen bg-[var(--base)] text-[var(--text)] flex items-center justify-center">
      <div className="w-full max-w-[520px] flex flex-col h-[min(100vh,760px)] mx-auto my-auto">
        <TopBar />

        <div className="flex-1 px-4 py-4">
          <Tabs defaultValue={defaultTab}>
            <TabsList className="mb-4 grid w-full grid-cols-2 bg-[var(--mantle)]">
              <TabsTrigger value="record">Record</TabsTrigger>
              <TabsTrigger value="decode">Decode</TabsTrigger>
            </TabsList>

            <TabsContent value="record" className="mt-0">
              <RecordPanel />
            </TabsContent>

            <TabsContent value="decode" className="mt-0">
              <DecodePanel initialData={initialData} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
