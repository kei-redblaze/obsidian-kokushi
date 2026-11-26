import { App } from "obsidian";
import type { SessionService } from "../services/SessionService";
import { openSessionDetails, SessionDetailActions } from "./SessionDetailsModal";
import { formatSessionDate } from "./sessionFormatting";

export function renderDraftList(
  root: HTMLElement,
  app: App,
  service: SessionService,
  actions: Pick<SessionDetailActions, "resume" | "retry">,
): void {
  const heading = root.createDiv({ cls: "kokushi-section-heading" });
  heading.createEl("h3", { text: "未完了の演習" });
  const content = root.createDiv();
  let generation = 0;

  const refresh = async (): Promise<void> => {
    const request = ++generation;
    try {
      const drafts = await service.getDrafts();
      if (request !== generation) return;
      content.empty();
      if (drafts.length === 0) {
        content.createEl("p", { text: "未完了の演習はありません。" });
        return;
      }

      const list = content.createEl("ul");
      for (const draft of drafts) {
        const item = list.createEl("li");
        const label = `${formatSessionDate(draft.recordedAt)}、第${draft.currentIndex + 1}問 / 全${draft.total}問`;
        const button = item.createEl("button", {
          text: "詳細",
          type: "button",
          attr: { "aria-label": `${label}の演習の詳細` },
        });
        button.onclick = () => { void openSessionDetails(app, service, draft.id, { ...actions, refresh }); };
        item.createSpan({ text: ` ${label}` });
      }
    } catch (error) {
      if (request !== generation) return;
      console.error("[Kokushi] Draft list error", error);
      content.empty();
      content.createEl("p", { text: "未完了の演習を読み込めませんでした。" });
    }
  };
  void refresh();
}
