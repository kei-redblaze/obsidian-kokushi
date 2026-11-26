import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { QuestionIssue, QuestionService } from "../services/QuestionService";
import { openQuestionEditor } from "./QuestionEditor";

import { bindAppearance, unbindAppearance, KokushiPreferences } from "./KokushiAppearance";

export class KokushiSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private questions: QuestionService,
    private preferences: KokushiPreferences,
    private update: (change: Partial<KokushiPreferences>) => Promise<KokushiPreferences | null>,
  ) {
    super(app, plugin);
  }

  display(): void {
    const root = this.containerEl;
    root.empty();
    const color = new Setting(root).setName("カスタム色");
    color.addColorPicker(picker => picker.setValue(this.preferences.accent).onChange(async accent => {
      const saved = await this.update({ accent });
      if (saved) this.preferences = saved;
      else picker.setValue(this.preferences.accent);
    }));
    color.settingEl.hidden = !this.preferences.customAccent;

    const mode = new Setting(root).setName("アクセントカラー").addDropdown(dropdown => {
      dropdown.addOption("theme", "Obsidianのテーマに従う").addOption("custom", "カスタム");
      dropdown.setValue(this.preferences.customAccent ? "custom" : "theme").onChange(async value => {
        const saved = await this.update({ customAccent: value === "custom" });
        if (saved) this.preferences = saved;
        else dropdown.setValue(this.preferences.customAccent ? "custom" : "theme");
        color.settingEl.hidden = !this.preferences.customAccent;
      });
    });
    root.prepend(mode.settingEl);

    new Setting(root).setName("問題セットの書式チェック").addButton(button => button
      .setButtonText("問題セットをチェック").onClick(() => new QuestionCheckModal(this.app, this.questions).open()));
  }
}

class QuestionCheckModal extends Modal {
  constructor(app: App, private questions: QuestionService) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.setTitle("問題セットの書式チェック");
    bindAppearance(this.app, this.modalEl);
    const root = this.contentEl.createDiv({ cls: "kokushi-question-check" });
    const status = root.createEl("p", { text: "問題セットをチェックしています…" });
    try {
      const issues = await this.questions.checkFormat();
      if (!this.contentEl.contains(root)) return;
      status.setText(issues.length ? `${issues.length}件の指摘があります。` : "書式の問題は見つかりませんでした。");
      this.renderIssues(root, issues);
    } catch (error) {
      console.error("[Kokushi] Question check error", error);
      status.setText("問題セットをチェックできませんでした。");
      new Notice("問題セットのチェックに失敗しました。");
    }
  }

  private renderIssues(root: HTMLElement, issues: QuestionIssue[]): void {
    if (!issues.length) return;
    const list = root.createEl("ul");
    for (const issue of issues) {
      const item = list.createEl("li");
      item.createEl("p", { text: [issue.path, issue.id, issue.reason].filter(Boolean).join(" — ") });
      const open = item.createEl("button", { type: "button", text: "Markdownを開く" });
      open.onclick = () => { this.close(); void openQuestionEditor(this.app, issue.path); };
    }
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.contentEl.empty();
  }
}
