
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
