export function formatSessionDate(value: string, timeZone?: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
}
