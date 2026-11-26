import { t } from "../i18n";
import { bindAppearance, unbindAppearance } from "./KokushiAppearance";
import { App, FuzzySuggestModal, Modal, Platform, TFile } from "obsidian";

export class StudyNotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private notes: TFile[], private choose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(t("関連付けるノートを検索"));
  }

  getItems(): TFile[] {
    return this.notes;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

export class CreateStudyNoteModal extends Modal {
  private stopFitting: (() => void) | null = null;
  constructor(
    app: App,
    private create: (title: string) => Promise<TFile>,
    private attach: (file: TFile) => Promise<void>,
    private openNote: (file: TFile) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("新規ノート"));
    const form = this.contentEl.createEl("form");
    bindAppearance(this.app, this.modalEl);
    const fields = form.createDiv({ cls: "kokushi-note-create-row" });
    const input = fields.createEl("input", { type: "text", placeholder: t("ノート名を入力"), attr: { "aria-label": t("ノート名") } });
    input.required = true;
    const submit = fields.createEl("button", { text: t("作成"), cls: "mod-cta", type: "submit" });
    const status = form.createDiv({ cls: "kokushi-study-error", attr: { role: "status" } });
    let created: TFile | null = null;

    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      input.disabled = true;
      status.setText("");

      try {
        created ??= await this.create(input.value);
        await this.attach(created);
        this.close();
        this.openNote(created);
      } catch (error) {
        if (created) {
          console.error("[Kokushi] New note link error", error);
          status.setText(t("ノートを作成しました。関連付けを保存できませんでした。"));
          submit.setText(t("関連付けを再試行"));
        } else {
          status.setText(error instanceof Error ? error.message : t("ノートを作成できませんでした。"));
          input.disabled = false;
          input.focus();
        }
        submit.disabled = false;
      }
    };
    if (Platform.isIosApp && Platform.isTablet) {
      this.fitTabletViewport();
      input.focus({ preventScroll: true });
    } else {
      input.focus();
    }
  }

  private fitTabletViewport(): void {
    const view = this.modalEl.ownerDocument.defaultView ?? window;
    const viewport = view.visualViewport;
    this.containerEl.addClass("kokushi-note-modal-container");
    this.modalEl.addClass("kokushi-note-modal");
    const fit = (): void => {
      const height = viewport?.height || view.innerHeight;
      this.containerEl.setCssProps({ "--kokushi-note-viewport-height": `${height}px` });
      const spareHeight = Math.max(0, height - this.modalEl.offsetHeight - 24);
      const top = Math.max(0, viewport?.offsetTop ?? 0) + 12 + Math.round(spareHeight * 0.4);
      this.containerEl.setCssProps({ "--kokushi-note-viewport-top": `${top}px` });
    };
    fit();
    view.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    const observer = new ResizeObserver(fit);
    observer.observe(this.modalEl);
    this.stopFitting = () => {
      observer.disconnect();
      view.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    };
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.stopFitting?.();
    this.stopFitting = null;
    this.contentEl.empty();
  }
}
