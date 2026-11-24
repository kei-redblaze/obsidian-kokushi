import { App, Notice } from "obsidian";
import { DASHBOARD_HISTORY_LIMIT } from "../constants";
import { SessionService, SessionSummary } from "../services/SessionService";
import { SessionRecord } from "../types";
import { SessionDetailsModal } from "./SessionDetailsModal";
import { formatSessionDate } from "./sessionFormatting";

const STATUS_LABELS = {
  completed: "完了",
  interrupted: "中断",
  active: "演習中",
};

export async function renderSessionHistory(
  root: HTMLElement,
  app: App,
  service: SessionService,
  onRetry: (record: SessionRecord) => Promise<boolean>,
  onResume: (id: string) => Promise<void>,
  onShowAll?: () => void,
): Promise<void> {
  const content = root.createDiv();
  const status = content.createEl("p", { text: "演習履歴を読み込んでいます…" });

  const openSession = async (item: SessionSummary, button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    try {
      if (item.status === "interrupted") {
        await onResume(item.id);
        return;
      }

      const record = await service.getSession(item.id);
      if (!record || record.status === "in-progress") {
        new Notice("演習履歴が見つかりませんでした。");
        return;
      }
      new SessionDetailsModal(app, record, onRetry).open();
    } catch (error) {
      console.error("[Kokushi] Session history action error", error);
      new Notice("演習履歴を開けませんでした。");
    } finally {
      button.disabled = false;
    }
  };

  try {
    const { sessions, invalid, hasMore } = await service.getHistory(
      onShowAll ? DASHBOARD_HISTORY_LIMIT : undefined
    );
    status.remove();

    if (invalid > 0) {
      content.createEl("p", {
        text: `読み込めなかった演習履歴が${invalid}件あります。`,
        cls: "kokushi-dashboard-warning",
      });
    } else if (sessions.length === 0) {
      content.createEl("p", { text: "演習履歴はまだありません。" });
    }

    if (sessions.length === 0) return;
    const table = content.createEl("table", { cls: "kokushi-dashboard-history" });
    const header = table.createEl("thead").createEl("tr");
    const body = table.createEl("tbody");
    for (const label of ["開始日時", "状態", "操作", "出題数", "正解", "不正解", "未採点", "採点除外", "正答率"]) {
      header.createEl("th", { text: label, attr: { scope: "col" } });
    }

    for (const item of sessions) {
      const { startedAt, total, result } = item;
      const row = body.createEl("tr");
      const date = formatSessionDate(startedAt);
      row.createEl("td", { text: date });
      row.createEl("td", { text: STATUS_LABELS[item.status] });
      const action = row.createEl("td");
      if (item.status !== "active") {
        const label = item.status === "interrupted" ? "再開" : "詳細";
        const button = action.createEl("button", {
          text: label,
          attr: { "aria-label": `${date}の演習を${label === "再開" ? "再開" : "詳細表示"}` },
          cls: "kokushi-dashboard-link",
        });
        button.type = "button";
        button.onclick = () => { void openSession(item, button); };
      } else {
        action.setText("—");
      }

      const accuracy = result.accuracy === null ? "—" : `${result.accuracy.toFixed(1)}%`;
      for (const value of [total, result.correct, result.incorrect, result.unanswered, result.excluded, accuracy]) {
        row.createEl("td", { text: String(value) });
      }
    }

    if (hasMore && onShowAll) {
      const more = content.createEl("button", {
        text: "すべて表示",
        attr: { "aria-label": "演習履歴をすべて表示" },
      });
      more.type = "button";
      more.onclick = onShowAll;
    }
  } catch (error) {
    console.error("[Kokushi] Session history load error", error);
    status.setText("演習履歴を読み込めませんでした。");
    status.addClass("kokushi-dashboard-warning");
  }
}
