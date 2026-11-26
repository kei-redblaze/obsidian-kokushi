import { t } from "../i18n";
import { bindAppearance, unbindAppearance } from "./KokushiAppearance";
import { App, Modal } from "obsidian";

export class SourceSelectionModal extends Modal {
  constructor(
    app: App,
    private sources: string[],
    private initial: string[] | null,
    private apply: (selected: string[] | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("出典を選択"));
    bindAppearance(this.app, this.modalEl);
    const selected = new Set(this.initial ?? this.sources);
    const root = this.contentEl;
    root.addClass("kokushi-source-modal");
    const actions = root.createDiv({ cls: "kokushi-source-modal-tools" });
    const all = actions.createEl("button", { type: "button", text: t("全選択") });
    const clear = actions.createEl("button", { type: "button", text: t("全解除") });
    const list = root.createDiv({
      cls: "kokushi-source-modal-list",
      attr: { role: "group", "aria-label": t("出典一覧") },
    });
    const inputs = new Map<string, HTMLInputElement>();
    for (const source of this.sources) {
      const label = list.createEl("label");
      const input = label.createEl("input", { type: "checkbox" });
      input.checked = selected.has(source);
      input.onchange = () => {
        if (input.checked) selected.add(source);
        else selected.delete(source);
      };
      label.createSpan({ text: source });
      inputs.set(source, input);
    }

    const selectAll = (checked: boolean): void => {
      selected.clear();
      for (const [source, input] of inputs) {
        input.checked = checked;
        if (checked) selected.add(source);
      }
    };
    all.onclick = () => selectAll(true);
    clear.onclick = () => selectAll(false);

    const footer = root.createDiv({ cls: "kokushi-source-modal-footer" });
    const cancel = footer.createEl("button", { type: "button", text: t("キャンセル") });
    const apply = footer.createEl("button", { type: "button", cls: "mod-cta", text: t("適用") });
    cancel.onclick = () => this.close();
    apply.onclick = () => {
      this.apply(selected.size === this.sources.length ? null : this.sources.filter(source => selected.has(source)));
      this.close();
    };
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.contentEl.empty();
  }
}
