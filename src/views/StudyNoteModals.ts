import { App, FuzzySuggestModal, Modal, Platform, TFile } from "obsidian";

export class StudyNotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private notes: TFile[], private choose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder("関連付けるノートを検索");
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
    this.setTitle("新規ノート");
    const form = this.contentEl.createEl("form");
    const label = form.createEl("label", { text: "ノート名", cls: "kokushi-study-field" });
    const input = label.createEl("input", { type: "text" });
    input.required = true;
    const submit = form.createEl("button", { text: "作成", cls: "mod-cta", type: "submit" });
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
          status.setText("ノートを作成しました。関連付けを保存できませんでした。");
          submit.setText("関連付けを再試行");
        } else {
          status.setText(error instanceof Error ? error.message : "ノートを作成できませんでした。");
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
      this.containerEl.setCssProps({
        "--kokushi-note-viewport-top": `${Math.max(0, viewport?.offsetTop ?? 0)}px`,
        "--kokushi-note-viewport-height": `${viewport?.height || view.innerHeight}px`,
      });
    };
    fit();
    view.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    this.stopFitting = () => {
      view.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    };
  }

  onClose(): void {
    this.stopFitting?.();
    this.stopFitting = null;
    this.contentEl.empty();
  }
}
