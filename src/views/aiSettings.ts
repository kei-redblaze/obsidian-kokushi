import { Notice, Setting } from "obsidian";
import { KokushiAI } from "../ai/KokushiAI";
import { ENGLISH_SUBJECTS, JAPANESE_SUBJECTS, parseSubjects } from "../ai/subjects";
import { t } from "../i18n";
import { QuestionService } from "../services/QuestionService";

export function renderAISettings(root: HTMLElement, ai: KokushiAI, questions: QuestionService, refreshScopes: () => void): void {
  const model = new Setting(root)
    .setName(t("端末内AIモデル"))
    .setDesc(t("関連ノート候補と分野分類に使用します。初回の取得は約135 MBです。"));
  const status = root.createDiv({ attr: { role: "status" } });
  if (ai.isReady) status.setText(t("モデルは準備できています。"));
  model.addButton(button => button.setButtonText(t("モデルを取得")).onClick(async () => {
    button.setDisabled(true);
    status.setText(t("モデルを準備しています…"));
    try {
      await ai.prepare((complete, total) => status.setText(t("モデルファイルを読み込み中（{0}/{1}）", complete, total)));
      status.setText(t("モデルは準備できています。"));
    } catch (error) {
      console.error("[Kokushi] Model preparation failed", error);
      status.setText(t("モデルを準備できませんでした。端末の空き容量と接続を確認してください。"));
    } finally {
      button.setDisabled(false);
    }
  }));

  const fields = new Setting(root).setName(t("分野リスト"))
    .setDesc(t("分野名を1行ずつ入力します。保存時に問題を分類します。"));
  const editor = root.createEl("textarea", {
    cls: "kokushi-subject-editor",
    attr: { "aria-label": t("分野リスト"), rows: "8" },
  });
  editor.value = ai.subjects.join("\n");
  const actions = root.createDiv({ cls: "kokushi-history-actions" });
  const ja = actions.createEl("button", { type: "button", text: t("日本語のデフォルトを読み込む") });
  const en = actions.createEl("button", { type: "button", text: t("英語のデフォルトを読み込む") });
  const save = actions.createEl("button", { type: "button", text: t("保存して分類を更新"), cls: "mod-cta" });
  const classificationStatus = root.createDiv({ attr: { role: "status" } });
  fields.settingEl.addClass("kokushi-subject-setting");
  ja.onclick = () => { editor.value = JAPANESE_SUBJECTS.join("\n"); editor.focus(); };
  en.onclick = () => { editor.value = ENGLISH_SUBJECTS.join("\n"); editor.focus(); };
  save.onclick = async () => {
    const subjects = parseSubjects(editor.value);
    if (subjects.length && !ai.isReady) {
      new Notice(t("先にモデルを取得してください。"));
      return;
    }
    save.disabled = ja.disabled = en.disabled = editor.disabled = true;
    classificationStatus.setText(t("分野を分類しています…"));
    try {
      const available = subjects.length ? await questions.getQuestions() : [];
      await ai.classify(available, subjects, (complete, total) => {
        classificationStatus.setText(t("分類中（{0}/{1}）", complete, total));
      });
      editor.value = ai.subjects.join("\n");
      classificationStatus.setText(t("分野の分類を更新しました。"));
      refreshScopes();
    } catch (error) {
      console.error("[Kokushi] Classification update failed", error);
      classificationStatus.setText(t("分野の分類を更新できませんでした。"));
    } finally {
      save.disabled = ja.disabled = en.disabled = editor.disabled = false;
    }
  };
}
