import { t } from "../i18n";
import { bindAppearance, unbindAppearance } from "./KokushiAppearance";
import { App, Modal } from "obsidian";

export class DiscardSessionModal extends Modal {
  constructor(
    app: App,
    private onDiscard: (includeAttempts: boolean) => Promise<void>,
    private title = t("演習履歴を破棄"),
  ) {
    super(app);
  }

  onOpen(): void {
    bindAppearance(this.app, this.modalEl);
    this.setTitle(this.title);
    const root = this.contentEl;
    const explanation = root.createEl("p", { text: t("この演習の履歴を削除します。") });
    const label = root.createEl("label", { cls: "kokushi-study-check" });
    const checkbox = label.createEl("input", { type: "checkbox" });
    label.createSpan({ text: t("この回の解答履歴も削除する") });
    checkbox.onchange = () => {
      explanation.setText(checkbox.checked
        ? t("この演習の履歴と、この演習中の解答履歴を削除します。")
        : t("この演習の履歴を削除します。"));
    };
    const status = root.createEl("p", { cls: "kokushi-study-error", attr: { role: "status" } });
    const actions = root.createDiv({ cls: "kokushi-history-actions" });
    const remove = actions.createEl("button", { text: t("削除"), type: "button", cls: "mod-warning" });
    const cancel = actions.createEl("button", { text: t("キャンセル"), type: "button" });
    cancel.onclick = () => { this.close(); };
    remove.onclick = async () => {
      if (remove.disabled) return;
      remove.disabled = cancel.disabled = checkbox.disabled = true;
      try {
        await this.onDiscard(checkbox.checked);
        this.close();
      } catch (error) {
        console.error("[Kokushi] Discard session error", error);
        status.setText(t("演習履歴を削除できませんでした。"));
      } finally {
        remove.disabled = cancel.disabled = checkbox.disabled = false;
      }
    };
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.contentEl.empty();
  }
}
