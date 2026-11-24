import { Attempt, PracticeTarget, Question, SessionRecord } from "../types";

export const ALL_PRACTICE_TARGETS: readonly PracticeTarget[] = ["correct", "incorrect", "unanswered"];

export function latestAttemptResults(attempts: Attempt[]): Map<string, boolean | null> {
  return new Map(attempts.map(attempt => [attempt.id, attempt.correct]));
}

export function practiceTarget(question: Question, latest: boolean | null | undefined): PracticeTarget {
  if (latest === undefined) return "unanswered";
  return question.excluded || latest !== false ? "correct" : "incorrect";
}

export function savedPracticeTargets(scope: SessionRecord["scope"]): PracticeTarget[] {
  return scope.targets ? [...scope.targets] :
    scope.target === "all" ? [...ALL_PRACTICE_TARGETS] : [scope.target];
}
