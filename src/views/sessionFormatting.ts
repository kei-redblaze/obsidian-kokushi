import { locale, t } from "../i18n";
import { Attempt, GradeResult } from "../types";

const GRADE_LABELS = { correct: "正解", incorrect: "不正解", excluded: "採点除外" } as const;

export function gradeLabel(grade: GradeResult | null): string {
  return t(grade === null ? "未採点" : GRADE_LABELS[grade]);
}

function dateLocale(): string {
  return locale() === "ja" ? "ja-JP" : "en-GB";
}

export function formatSessionDate(value: string, timeZone?: string): string {
  return new Date(value).toLocaleString(dateLocale(), {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function renderHistoryDate(root: HTMLElement, value: string, timeZone?: string): void {
  const date = new Date(value);
  const time = root.createEl("time", { cls: "kokushi-history-date", attr: { datetime: value } });
  time.createSpan({ text: date.toLocaleDateString(dateLocale(), { timeZone, dateStyle: "short" }) });
  time.createSpan({ text: date.toLocaleTimeString(dateLocale(), { timeZone, timeStyle: "short" }) });
}

export function renderHistoryGrade(root: HTMLElement, grade: GradeResult | null): void {
  root.createSpan({
    text: gradeLabel(grade),
    cls: `kokushi-result-grade is-${grade ?? "unanswered"}`,
  });
}

export function formatAttemptAnswer(attempt: Attempt): string {
  return (attempt.unknown ?? attempt.selected.length === 0) ? t("わからない") : attempt.selected.join(", ");
}
