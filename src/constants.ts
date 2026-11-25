export const ATTEMPTS_FOLDER = "02_Attempts";
export const PATHS = {
  dashboard: "00_Dashboard",
  questions: "01_Questions",
  attempts: `${ATTEMPTS_FOLDER}/attempts.jsonl`,
  sessions: `${ATTEMPTS_FOLDER}/sessions`,
  notes: "03_Notes",
} as const;

export const DASHBOARD_HISTORY_LIMIT = 5;
