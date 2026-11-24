
export type QuestionType =
  | "single"
  | "multiple"
  | "numeric";

export type GradeResult =
  | "correct"
  | "incorrect"
  | "excluded";

export interface Question {
  id: string;
  type: QuestionType;
  answer: string[][];
  excluded: boolean;

  markdown: string;
  path: string;
}

export interface Attempt {
  id: string;
  timestamp: string;
  selected: string[];
  correct: boolean | null;
}

export interface SessionResult {
  correct: number;
  incorrect: number;
  unanswered: number;
  excluded: number;
  accuracy: number | null;
}

export interface SessionRecord {
  schemaVersion: 1;
  id: string;
  startedAt: string;
  recordedAt: string;
  // v0.1.10 の履歴には status がなく、完了済みとして扱う。
  status?: "in-progress" | "completed";
  currentIndex?: number;
  sourceSessionId?: string;
  scope: {
    exams: string[] | null;
    order: "sequential" | "random";
    target: "all" | "unanswered" | "incorrect";
  };
  result: SessionResult;
  questions: {
    id: string;
    selected: string[];
    grade: GradeResult | null;
    unknown: boolean;
  }[];
}

export type HistoryRetryMode = "all" | "incorrect";
