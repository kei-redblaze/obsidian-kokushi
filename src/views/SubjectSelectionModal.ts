import { App, Modal } from "obsidian";
import { UNCLASSIFIED } from "../ai/subjects";
import { t } from "../i18n";
import { bindAppearance, unbindAppearance } from "./KokushiAppearance";

export function subjectLabel(subject: string): string {
  return subject === UNCLASSIFIED ? t("未分類") : subject;
}

export class SubjectSelectionModal extends Modal {
  constructor(
    app: App,
    private subjects: readonly string[],
    private initial: readonly string[] | null,
    private apply: (selected: string[] | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("分野を選択"));
    bindAppearance(this.app, this.modalEl);
    const items = [...this.subjects, UNCLASSIFIED];
    const selected = new Set(this.initial ?? items);
    const root = this.contentEl;
    root.addClass("kokushi-source-modal");
    const actions = root.createDiv({ cls: "kokushi-source-modal-tools" });
    const all = actions.createEl("button", { type: "button", text: t("全選択") });
    const clear = actions.createEl("button", { type: "button", text: t("全解除") });
    const list = root.createDiv({
      cls: "kokushi-source-modal-list kokushi-scope-buttons",
      attr: { role: "group", "aria-label": t("分野一覧") },
    });
    const buttons = new Map<string, HTMLButtonElement>();
    const sync = (): void => {
      for (const [subject, button] of buttons) {
        button.classList.toggle("is-selected", selected.has(subject));
        button.setAttribute("aria-pressed", String(selected.has(subject)));
      }
    };
    for (const subject of items) {
      const button = list.createEl("button", { type: "button", cls: "kokushi-scope-button", text: subjectLabel(subject) });
      buttons.set(subject, button);
      button.onclick = () => {
        if (selected.has(subject)) selected.delete(subject);
        else selected.add(subject);
        sync();
      };
    }
    all.onclick = () => { items.forEach(subject => selected.add(subject)); sync(); };
    clear.onclick = () => { selected.clear(); sync(); };
    sync();
    const footer = root.createDiv({ cls: "kokushi-source-modal-footer" });
    const cancel = footer.createEl("button", { type: "button", text: t("キャンセル") });
    const apply = footer.createEl("button", { type: "button", cls: "mod-cta", text: t("適用") });
    cancel.onclick = () => this.close();
    apply.onclick = () => {
      this.apply(selected.size === items.length ? null : items.filter(subject => selected.has(subject)));
      this.close();
    };
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.contentEl.empty();
  }
}
