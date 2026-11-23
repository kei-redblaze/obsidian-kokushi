
export const PATHS = {
  dashboard: "00_Dashboard",
  questions: "01_Questions",
  attempts: "02_Attempts/attempts.jsonl",
  notes: "03_Notes",
} as const;

export const QUESTION_ID_PATTERN =
  /^(\d+)([A-F])([1-9]\d*)$/;
