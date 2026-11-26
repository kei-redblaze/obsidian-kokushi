import type { Attempt, QuestionReference } from "../types";
import { questionKey } from "../services/QuestionIdentity";
import { attemptGrade, attemptRating, PRACTICE_TARGET_LABELS } from "../services/PracticeTargets";
import { renderHistoryDate, renderHistoryGrade } from "./sessionFormatting";

export function renderInvalidAttempts(root: HTMLElement, invalidLines: number): void {
  if (invalidLines === 0) return;
  root.createEl("p", {
    cls: "kokushi-dashboard-warning",
    text: `解答履歴に不正な行が${invalidLines}件あります。これらを除いて集計しました。`,
  });
}

export function renderAttemptHistory(
  root: HTMLElement,
  attempts: Attempt[],
  availableIds: Set<string>,
  onOpenQuestion: (reference: QuestionReference) => Promise<void>,
): void {
  if (attempts.length === 0) {
    root.createEl("p", { text: "解答履歴はまだありません。" });
    return;
  }

  const table = root.createEl("table", { cls: "kokushi-dashboard-history" });
  const header = table.createEl("thead").createEl("tr");
  for (const title of ["出典", "問題", "日時", "解答", "評価", "採点結果"]) {
    header.createEl("th", { text: title, attr: { scope: "col" } });
  }

  const body = table.createEl("tbody");
  for (const attempt of attempts) {
    const row = body.createEl("tr");
    row.createEl("td", { text: attempt.source });
    const idCell = row.createEl("td");
    if (availableIds.has(questionKey(attempt))) {
      const button = idCell.createEl("button", { text: attempt.id, cls: "kokushi-dashboard-link" });
      button.type = "button";
      button.onclick = () => { void onOpenQuestion(attempt); };
    } else {
      idCell.setText(attempt.id);
    }

    renderHistoryDate(row.createEl("td"), attempt.timestamp, "Asia/Tokyo");
    row.createEl("td", { text: attempt.selected.join(", ") });
    row.createEl("td", { text: PRACTICE_TARGET_LABELS[attemptRating(attempt)] });
    renderHistoryGrade(row.createEl("td"), attemptGrade(attempt));
  }
}
