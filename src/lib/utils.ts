import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui class name helper */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format byte count for display (e.g. "1.2 KB") */
export function fmt(b: number): string {
  return b < 1024 ? b + " B" : (b / 1024).toFixed(1) + " KB";
}
