export const ATTEMPTS_FOLDER = "03_Data/Attempts";
export const PATHS = {
  questions: "01_Questions",
  attempts: `${ATTEMPTS_FOLDER}/attempts.jsonl`,
  sessions: `${ATTEMPTS_FOLDER}/sessions`,
  notes: "02_Notes",
  study: "03_Data/YAML",
} as const;

export const DASHBOARD_HISTORY_LIMIT = 5;
