import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface ModelLoadingCardProps {
  modelName: string;
  progress: number; // 0-100
  speed: string;
  onCancel: () => void;
}

export function ModelLoadingCard({
  modelName,
  progress,
  speed,
  onCancel,
}: ModelLoadingCardProps) {
  return (
    <Card className="bg-[var(--mantle)] border-[var(--surface0)] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-[var(--text)] truncate">
          {modelName}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] min-w-[44px] p-0 text-[var(--overlay)] hover:text-[var(--red)]"
          onClick={onCancel}
          title="Cancel download"
        >
          <X className="size-4" />
        </Button>
      </div>
      <Progress
        value={Math.min(100, progress)}
        className="h-1.5 bg-[var(--surface0)]"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[0.6rem] text-[var(--overlay)]">
          {Math.round(progress)}%
        </span>
        <span className="text-[0.6rem] text-[var(--overlay)]">{speed}</span>
      </div>
    </Card>
  );
}
