import type { SessionService } from "../services/SessionService";
import { formatSessionDate } from "./sessionFormatting";

export async function renderDraftList(
  root: HTMLElement,
  service: SessionService,
  resume: (id: string) => Promise<void>
): Promise<void> {
  try {
    const drafts = await service.getDrafts();
    if (drafts.length === 0) return;

    root.createEl("h3", { text: "中断した演習" });
    const list = root.createEl("ul");
    for (const draft of drafts) {
      const item = list.createEl("li");
      const label = `${formatSessionDate(draft.recordedAt)}、第${draft.currentIndex + 1}問 / 全${draft.total}問`;
      const button = item.createEl("button", {
        text: "再開",
        attr: { "aria-label": `${label}の演習を再開` },
      });
      button.type = "button";
      button.onclick = () => { void resume(draft.id); };
      item.createSpan({ text: ` ${label}` });
    }
  } catch (error) {
    console.error("[Kokushi] Draft list error", error);
    root.createEl("p", { text: "中断した演習を読み込めませんでした。" });
  }
}
