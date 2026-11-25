import { App, Modal } from "obsidian";

export class DiscardSessionModal extends Modal {
  constructor(
    app: App,
    private onDiscard: (includeAttempts: boolean) => Promise<void>,
    private title = "演習履歴を破棄",
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.title);
    const root = this.contentEl;
    const explanation = root.createEl("p", { text: "この演習の履歴を削除します。" });
    const label = root.createEl("label", { cls: "kokushi-study-check" });
    const checkbox = label.createEl("input", { type: "checkbox" });
    label.createSpan({ text: "この回の解答履歴も削除する" });
    checkbox.onchange = () => {
      explanation.setText(checkbox.checked
        ? "この演習の履歴と、この演習中の解答履歴を削除します。"
        : "この演習の履歴を削除します。");
    };
    const status = root.createEl("p", { cls: "kokushi-study-error", attr: { role: "status" } });
    const actions = root.createDiv({ cls: "kokushi-history-actions" });
    const remove = actions.createEl("button", { text: "削除", type: "button", cls: "mod-warning" });
    const cancel = actions.createEl("button", { text: "キャンセル", type: "button" });
    cancel.onclick = () => { this.close(); };
    remove.onclick = async () => {
      if (remove.disabled) return;
      remove.disabled = cancel.disabled = checkbox.disabled = true;
      try {
        await this.onDiscard(checkbox.checked);
        this.close();
      } catch (error) {
        console.error("[Kokushi] Discard session error", error);
        status.setText("演習履歴を削除できませんでした。");
      } finally {
        remove.disabled = cancel.disabled = checkbox.disabled = false;
      }
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
