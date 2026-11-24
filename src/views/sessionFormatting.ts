export function formatSessionDate(value: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
