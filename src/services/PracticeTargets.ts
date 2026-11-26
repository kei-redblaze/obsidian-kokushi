import { questionKey } from "./QuestionIdentity";
import { Attempt, GradeResult, PracticeTarget } from "../types";

export const PRACTICE_TARGET_LABELS: Record<PracticeTarget, string> = {
  excellent: "◎",
  good: "◯",
  review: "△",
  wrong: "×",
  unanswered: "未解答",
};

export const ALL_PRACTICE_TARGETS: readonly PracticeTarget[] = ["excellent", "good", "review", "wrong", "unanswered"];
export const DEFAULT_PRACTICE_TARGETS: readonly PracticeTarget[] = ["good", "review", "wrong", "unanswered"];

export function defaultRating(grade: GradeResult | null): PracticeTarget {
  if (grade === null) return "unanswered";
  return grade === "incorrect" ? "wrong" : "good";
}

export function attemptGrade(attempt: Attempt): GradeResult {
  return attempt.correct === null ? "excluded" : attempt.correct ? "correct" : "incorrect";
}

export function attemptRating(attempt: Attempt): PracticeTarget {
  return attempt.rating ?? defaultRating(attemptGrade(attempt));
}

export function isPracticeTarget(value: unknown): value is PracticeTarget {
  return typeof value === "string" && ALL_PRACTICE_TARGETS.some(target => target === value);
}

export function latestAttemptRatings(attempts: Attempt[]): Map<string, PracticeTarget> {
  return new Map(attempts.map(attempt => [questionKey(attempt), attemptRating(attempt)]));
}
