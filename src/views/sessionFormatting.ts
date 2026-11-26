import { Attempt, GradeResult } from "../types";

export const GRADE_LABELS: Record<GradeResult, string> = {
  correct: "正解",
  incorrect: "不正解",
  excluded: "採点除外",
};

export function formatSessionDate(value: string, timeZone?: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function renderHistoryDate(root: HTMLElement, value: string, timeZone?: string): void {
  const date = new Date(value);
  const time = root.createEl("time", { cls: "kokushi-history-date", attr: { datetime: value } });
  time.createSpan({ text: date.toLocaleDateString("ja-JP", { timeZone, dateStyle: "short" }) });
  time.createSpan({ text: date.toLocaleTimeString("ja-JP", { timeZone, timeStyle: "short" }) });
}

export function renderHistoryGrade(root: HTMLElement, grade: GradeResult | null): void {
  root.createSpan({
    text: grade === null ? "未採点" : GRADE_LABELS[grade],
    cls: `kokushi-result-grade is-${grade ?? "unanswered"}`,
  });
}

export function formatAttemptAnswer(attempt: Attempt): string {
  return (attempt.unknown ?? attempt.selected.length === 0) ? "わからない" : attempt.selected.join(", ");
}
