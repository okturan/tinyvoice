/** Format byte count for display */
export function fmt(b: number): string {
  return b < 1024 ? b + " B" : (b / 1024).toFixed(1) + " KB";
}
