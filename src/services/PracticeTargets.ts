import { questionKey } from "./QuestionIdentity";
import { Attempt, PracticeTarget, Question } from "../types";

export const ALL_PRACTICE_TARGETS: readonly PracticeTarget[] = ["correct", "incorrect", "unanswered"];

export function latestAttemptResults(attempts: Attempt[]): Map<string, boolean | null> {
  return new Map(attempts.map(attempt => [questionKey(attempt), attempt.correct]));
}

export function practiceTarget(question: Question, latest: boolean | null | undefined): PracticeTarget {
  if (latest === undefined) return "unanswered";
  return question.excluded || latest !== false ? "correct" : "incorrect";
}
