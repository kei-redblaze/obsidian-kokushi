import { t } from "../i18n";
import { App } from "obsidian";
import { DASHBOARD_HISTORY_LIMIT } from "../constants";
import { SessionService } from "../services/SessionService";
import { openSessionDetails, SessionDetailActions } from "./SessionDetailsModal";
import { formatSessionDate, renderHistoryDate } from "./sessionFormatting";

const STATUS_LABELS = {
  completed: "完了",
  interrupted: "中断",
  active: "演習中",
} as const;

export async function renderSessionHistory(
  root: HTMLElement,
  app: App,
  service: SessionService,
  actions: SessionDetailActions,
  onShowAll?: () => void,
): Promise<void> {
  const content = root.createDiv();
  const status = content.createEl("p", { text: t("演習履歴を読み込んでいます…") });

  try {
    const { sessions, invalid, hasMore } = await service.getHistory(
      onShowAll ? DASHBOARD_HISTORY_LIMIT : undefined
    );
    status.remove();

    if (invalid > 0) {
      content.createEl("p", {
        text: t("読み込めなかった演習履歴が{0}件あります。", invalid),
        cls: "kokushi-dashboard-warning",
      });
    } else if (sessions.length === 0) {
      content.createEl("p", { text: t("演習履歴はまだありません。") });
    }

    if (sessions.length === 0) return;
    const table = content.createEl("table", { cls: "kokushi-dashboard-history" });
    const header = table.createEl("thead").createEl("tr");
    const body = table.createEl("tbody");
    for (const label of [t("開始日時"), t("状態"), t("出題数"), t("正解"), t("不正解"), t("未採点"), t("採点除外"), t("正答率")]) {
      header.createEl("th", { text: label, attr: { scope: "col" } });
    }

    for (const item of sessions) {
      const { startedAt, total, result } = item;
      const row = body.createEl("tr");
      const date = formatSessionDate(startedAt);
      renderHistoryDate(row.createEl("td"), startedAt);
      const button = row.createEl("td").createEl("button", {
        type: "button",
        text: t(STATUS_LABELS[item.status]),
        attr: { "aria-label": t("{0}の演習の詳細（{1}）", date, t(STATUS_LABELS[item.status])) },
      });
      button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          await openSessionDetails(app, service, item.id, actions);
        } finally {
          button.disabled = false;
        }
      };

      const accuracy = result.accuracy === null ? "—" : `${result.accuracy.toFixed(1)}%`;
      row.createEl("td", { text: String(total) });
      row.createEl("td", { text: String(result.correct), cls: "kokushi-result-grade is-correct" });
      row.createEl("td", { text: String(result.incorrect), cls: "kokushi-result-grade is-incorrect" });
      for (const value of [result.unanswered, result.excluded, accuracy]) {
        row.createEl("td", { text: String(value) });
      }
    }

    if (hasMore && onShowAll) {
      const more = content.createEl("button", {
        text: t("すべて表示"),
        attr: { "aria-label": t("演習履歴をすべて表示") },
      });
      more.type = "button";
      more.onclick = onShowAll;
    }
  } catch (error) {
    console.error("[Kokushi] Session history load error", error);
    status.setText(t("演習履歴を読み込めませんでした。"));
    status.addClass("kokushi-dashboard-warning");
  }
}
