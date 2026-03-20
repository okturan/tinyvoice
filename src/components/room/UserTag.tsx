import { Badge } from "@/components/ui/badge";

interface UserTagProps {
  name: string;
}

export function UserTag({ name }: UserTagProps) {
  return (
    <Badge variant="secondary" className="font-mono text-xs">
      {name}
    </Badge>
  );
}
