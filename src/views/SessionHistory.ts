import { App, Notice } from "obsidian";
import { SessionService } from "../services/SessionService";
import { SessionRecord } from "../types";
import { SessionDetailsModal } from "./SessionDetailsModal";
import { formatSessionDate } from "./sessionFormatting";

const PAGE_SIZE = 20;

export async function renderSessionHistory(
  root: HTMLElement,
  app: App,
  service: SessionService,
  onRetry: (record: SessionRecord) => Promise<boolean>,
): Promise<void> {
  root.createEl("h3", { text: "演習履歴" });
  const content = root.createDiv();

  const showDetails = async (id: string, button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    try {
      const record = await service.getSession(id);
      if (!record || record.status === "in-progress") {
        new Notice("演習履歴が見つかりませんでした。");
        return;
      }
      new SessionDetailsModal(app, record, onRetry).open();
    } catch (error) {
      console.error("[Kokushi] Session details load error", error);
      new Notice("演習履歴の詳細を読み込めませんでした。");
    } finally {
      button.disabled = false;
    }
  };

  const showHistory = async (limit: number): Promise<void> => {
    const status = content.createEl("p", { text: "演習履歴を読み込んでいます…" });
    try {
      const { sessions, invalid, hasMore } = await service.getRecent(limit);
      content.empty();

      if (invalid > 0) {
        content.createEl("p", {
          text: `読み込めなかった演習履歴が${invalid}件あります。`,
          cls: "kokushi-dashboard-warning",
        });
      } else if (sessions.length === 0) {
        content.createEl("p", { text: "演習結果を開くと、ここに履歴が表示されます。" });
      }

      if (sessions.length === 0) return;

      const table = content.createEl("table", { cls: "kokushi-dashboard-history" });
      const header = table.createEl("thead").createEl("tr");
      const body = table.createEl("tbody");
      for (const label of ["開始日時", "出題数", "正解", "不正解", "未採点", "採点除外", "正答率", "詳細"]) {
        header.createEl("th", { text: label, attr: { scope: "col" } });
      }

      for (const { id, startedAt, total, result } of sessions) {
        const row = body.createEl("tr");
        const date = formatSessionDate(startedAt);
        const accuracy = result.accuracy === null ? "—" : `${result.accuracy.toFixed(1)}%`;
        for (const value of [date, total, result.correct, result.incorrect, result.unanswered, result.excluded, accuracy]) {
          row.createEl("td", { text: String(value) });
        }
        const details = row.createEl("td").createEl("button", {
          text: "詳細",
          attr: { "aria-label": `${date}の演習履歴の詳細` },
          cls: "kokushi-dashboard-link",
        });
        details.type = "button";
        details.onclick = () => { void showDetails(id, details); };
      }

      if (hasMore) {
        const more = content.createEl("button", { text: "もっと見る" });
        more.type = "button";
        more.onclick = async () => {
          more.disabled = true;
          try {
            await showHistory(limit + PAGE_SIZE);
          } finally {
            more.disabled = false;
          }
        };
      }
    } catch (error) {
      console.error("[Kokushi] Session history load error", error);
      status.setText("演習履歴を読み込めませんでした。");
      status.addClass("kokushi-dashboard-warning");
    }
  };

  await showHistory(PAGE_SIZE);
}
