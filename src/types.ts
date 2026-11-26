
export type QuestionType =
  | "single"
  | "multiple"
  | "numeric";

export type GradeResult =
  | "correct"
  | "incorrect"
  | "excluded";

export interface QuestionReference {
  id: string;
  source: string;
}

export interface QuestionOption {
  id: string;
  markdown: string;
}

export interface Question extends QuestionReference {
  type: QuestionType;
  answer: string[][];
  excluded: boolean;

  requiredChoices: number | null;
  stem: string;
  annotation: string;
  options: QuestionOption[];
  path: string;
}

export interface Attempt extends QuestionReference {
  sessionId?: string;
  timestamp: string;
  selected: string[];
  correct: boolean | null;
  rating?: PracticeTarget;
}

export interface SessionResult {
  correct: number;
  incorrect: number;
  unanswered: number;
  excluded: number;
  accuracy: number | null;
}

export type PracticeTarget = "excellent" | "good" | "review" | "wrong" | "unanswered";

export interface SessionRecord {
  schemaVersion: 2;
  id: string;
  startedAt: string;
  recordedAt: string;
  status: "in-progress" | "completed";
  currentIndex?: number;
  sourceSessionId?: string;
  scope: {
    sources: string[] | null;
    order: "sequential" | "random";
    targets: PracticeTarget[];
  };
  result: SessionResult;
  questions: (QuestionReference & {
    selected: string[];
    grade: GradeResult | null;
    unknown: boolean;
  })[];
}

export type SessionDetails = Omit<SessionRecord, "questions"> & {
  questions: (SessionRecord["questions"][number] & { rating: PracticeTarget })[];
};

export type HistoryRetryMode = "all" | "incorrect";
