import type { AIControls } from "./AIControls";
import { renderAISettings } from "./aiSettings";
import { t } from "../i18n";
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";
import { QuestionIssue, QuestionService } from "../services/QuestionService";
import { DATA_FOLDER, PATHS } from "../constants";
import { ensureFolder } from "../services/VaultFolder";
import { openQuestionEditor } from "./QuestionEditor";

import { bindAppearance, unbindAppearance, isValidPresetCount, KokushiPreferences } from "./KokushiAppearance";

export class KokushiSettingTab extends PluginSettingTab {
  private stopWatchingAI?: () => void;
  constructor(
    app: App,
    plugin: Plugin,
    private questions: QuestionService,
    private preferences: KokushiPreferences,
    private update: (change: Partial<KokushiPreferences>) => Promise<KokushiPreferences | null>,
    private ai?: AIControls,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.hide();
    const root = this.containerEl;
    root.empty();
    new Setting(root).setName(t("表示言語")).setDesc(t("表示言語の変更はObsidianの再読み込み後に反映されます。")).addDropdown(dropdown => {
      dropdown.addOption("system", t("Obsidianに従う")).addOption("en", "English").addOption("ja", "日本語");
      dropdown.setValue(this.preferences.language).onChange(async value => {
        const saved = await this.update({ language: value === "ja" || value === "en" ? value : "system" });
        if (saved) this.preferences = saved;
        else dropdown.setValue(this.preferences.language);
      });
    });

    new Setting(root).setName(t("出題数のプリセット")).setDesc(t("出題範囲画面の固定の出題数を設定します。")).addText(field => {
      field.inputEl.type = "number";
      field.inputEl.setAttribute("aria-label", t("出題数のプリセット"));
      field.inputEl.min = "1";
      field.inputEl.step = "1";
      field.inputEl.inputMode = "numeric";
      field.setValue(String(this.preferences.presetCount));
      field.inputEl.addEventListener("change", () => {
        void (async () => {
          const count = field.inputEl.valueAsNumber;
          if (!isValidPresetCount(count)) {
            field.setValue(String(this.preferences.presetCount));
            new Notice(t("1以上の整数を入力してください。"));
            return;
          }
          const saved = await this.update({ presetCount: count });
          if (saved) this.preferences = saved;
          field.setValue(String(this.preferences.presetCount));
        })();
      });
    });

    const colorToggle = new Setting(root).setName(t("カスタムカラー"));
    const color = new Setting(root).setName(t("アクセントカラー"));
    color.addColorPicker(picker => picker.setValue(this.preferences.accent).onChange(async accent => {
      const saved = await this.update({ accent });
      if (saved) this.preferences = saved;
      else picker.setValue(this.preferences.accent);
    }));
    color.settingEl.addClass("kokushi-color-picker");
    color.settingEl.hidden = !this.preferences.customAccent;

    colorToggle.addToggle(toggle => toggle.setValue(this.preferences.customAccent).onChange(async enabled => {
      const saved = await this.update({ customAccent: enabled });
      if (saved) this.preferences = saved;
      else toggle.setValue(this.preferences.customAccent);
      color.settingEl.hidden = !this.preferences.customAccent;
    }));

    const setup = new Setting(root).setName(t("初期セットアップ")).setDesc(t("Vaultに問題・ノート・データのフォルダーを用意します。"));
    setup.addButton(button => button.setButtonText(t("フォルダーを作成")).onClick(async () => {
      button.setDisabled(true);
      try {
        await this.setupFolders();
      } finally {
        button.setDisabled(false);
      }
    }));

    if (this.ai) this.stopWatchingAI = renderAISettings(root, this.ai, () => this.preferences, async change => {
      const saved = await this.update(change);
      if (saved) this.preferences = saved;
    });

    new Setting(root).setName(t("問題セットの書式チェック")).addButton(button => button
      .setButtonText(t("問題セットをチェック")).onClick(() => new QuestionCheckModal(this.app, this.questions).open()));
  }
  hide(): void {
    this.stopWatchingAI?.();
    this.stopWatchingAI = undefined;
  }

  private async setupFolders(): Promise<void> {
    const vault = this.app.vault;
    const missing = [PATHS.questions, PATHS.notes, DATA_FOLDER].filter(path => !(vault.getAbstractFileByPath(path) instanceof TFolder));
    if (!missing.length) {
      new Notice(t("セットアップは完了しています"));
      return;
    }
    for (const path of missing) {
      const existing = vault.getAbstractFileByPath(path);
      if (existing && !(existing instanceof TFolder)) {
        new Notice(t("{0} はフォルダーではありません。", path));
        return;
      }
    }
    for (const path of missing) {
      try {
        await ensureFolder(vault, path);
      } catch (error) {
        console.error("[Kokushi] Folder setup error", path, error);
        new Notice(t("{0} を作成できませんでした。", path));
        return;
      }
    }
    new Notice(t("セットアップが完了しました"));
  }

}

class QuestionCheckModal extends Modal {
  constructor(app: App, private questions: QuestionService) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.setTitle(t("問題セットの書式チェック"));
    bindAppearance(this.app, this.modalEl);
    const root = this.contentEl.createDiv({ cls: "kokushi-question-check" });
    const status = root.createEl("p", { text: t("問題セットをチェックしています…") });
    try {
      const issues = await this.questions.checkFormat();
      if (!this.contentEl.contains(root)) return;
      status.setText(issues.length ? t("{0}件の指摘があります。", issues.length) : t("書式の問題は見つかりませんでした。"));
      this.renderIssues(root, issues);
    } catch (error) {
      console.error("[Kokushi] Question check error", error);
      status.setText(t("問題セットをチェックできませんでした。"));
      new Notice(t("問題セットのチェックに失敗しました。"));
    }
  }

  private renderIssues(root: HTMLElement, issues: QuestionIssue[]): void {
    if (!issues.length) return;
    const list = root.createEl("ul");
    for (const issue of issues) {
      const item = list.createEl("li");
      item.createEl("p", { text: [issue.path, issue.id, issue.reason].filter(Boolean).join(" — ") });
      const open = item.createEl("button", { type: "button", text: t("Markdownを開く") });
      open.onclick = () => { this.close(); void openQuestionEditor(this.app, issue.path); };
    }
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.contentEl.empty();
  }
}
