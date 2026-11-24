import type { DashboardAttempt } from "../services/StatisticsService";
import { formatSessionDate } from "./sessionFormatting";

export function renderInvalidAttempts(root: HTMLElement, invalidLines: number): void {
  if (invalidLines === 0) return;
  root.createEl("p", {
    cls: "kokushi-dashboard-warning",
    text: `解答履歴に不正な行が${invalidLines}件あります。これらを除いて集計しました。`,
  });
}

export function renderAttemptHistory(
  root: HTMLElement,
  attempts: DashboardAttempt[],
  availableIds: Set<string>,
  onOpenQuestion: (id: string) => Promise<void>,
): void {
  if (attempts.length === 0) {
    root.createEl("p", { text: "解答履歴はまだありません。" });
    return;
  }

  const table = root.createEl("table", { cls: "kokushi-dashboard-history" });
  const header = table.createEl("thead").createEl("tr");
  for (const title of ["問題", "日時", "解答", "判定"]) {
    header.createEl("th", { text: title, attr: { scope: "col" } });
  }

  const body = table.createEl("tbody");
  for (const attempt of attempts) {
    const row = body.createEl("tr");
    const idCell = row.createEl("td");
    if (availableIds.has(attempt.id)) {
      const button = idCell.createEl("button", { text: attempt.id, cls: "kokushi-dashboard-link" });
      button.type = "button";
      button.onclick = () => { void onOpenQuestion(attempt.id); };
    } else {
      idCell.setText(attempt.id);
    }

    row.createEl("td", { text: formatSessionDate(attempt.timestamp, "Asia/Tokyo") });
    row.createEl("td", { text: attempt.selected.join(", ") });
    row.createEl("td", {
      text: attempt.correct === null ? "採点除外" : attempt.correct ? "正解" : "不正解",
    });
  }
}
