export const DATA_FOLDER = "03_Data";
export const ATTEMPTS_FOLDER = `${DATA_FOLDER}/Attempts`;
export const PATHS = {
  questions: "01_Questions",
  attempts: `${ATTEMPTS_FOLDER}/attempts.jsonl`,
  sessions: `${ATTEMPTS_FOLDER}/sessions`,
  notes: "02_Notes",
  study: `${DATA_FOLDER}/YAML`,
} as const;

export const DASHBOARD_HISTORY_LIMIT = 5;
