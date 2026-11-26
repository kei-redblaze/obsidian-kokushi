import { t } from "../i18n";
import { bindAppearance, unbindAppearance } from "./KokushiAppearance";
import { App, Component, MarkdownRenderer, Modal } from "obsidian";
import { Attempt, Question } from "../types";
import { QuestionService } from "../services/QuestionService";
import { questionKey } from "../services/QuestionIdentity";
import { attemptGrade, attemptRating, ratingLabel } from "../services/PracticeTargets";
import { formatAttemptAnswer, renderHistoryDate, renderHistoryGrade } from "./sessionFormatting";
import { arrangeQuestionImages } from "./questionMedia";
import { bindImagePreview } from "./ImagePreviewModal";

export class AttemptPreviewModal extends Modal {
  private cleanup: (() => void)[] = [];

  constructor(app: App, private attempt: Attempt, private questions: QuestionService) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.component.load();
    const attempt = this.attempt;
    this.setTitle(`${attempt.source} ${attempt.id}`);
    bindAppearance(this.app, this.modalEl);
    const root = this.contentEl.createDiv({ cls: "kokushi-attempt-preview" });
    const summary = root.createDiv({ cls: "kokushi-preview-summary" });
    const heading = summary.createDiv({ text: t("当時の採点結果 ") });
    renderHistoryGrade(heading, attemptGrade(attempt));
    heading.createSpan({ text: t(" 評価 {0}", ratingLabel(attemptRating(attempt))) });
    renderHistoryDate(summary, attempt.timestamp, "Asia/Tokyo");
    const answer = formatAttemptAnswer(attempt);
    summary.createEl("p", { text: t("当時の解答：{0}", answer) });

    const body = root.createDiv();
    const status = body.createEl("p", { text: t("問題を読み込んでいます…") });
    const close = root.createEl("button", { text: t("閉じる"), type: "button" });
    close.onclick = () => this.close();
    const key = questionKey(attempt);
    try {
      const question = (await this.questions.getQuestions()).find(item => questionKey(item) === key);
      if (!this.contentEl.contains(root)) return;
      if (!question) {
        status.setText(t("現在の問題ファイルが見つかりません。"));
        return;
      }
      status.remove();
      await this.renderQuestion(body, question);
      if (!this.contentEl.contains(root)) return;
      this.cleanup.push(bindImagePreview(this.app, body, question.path));
    } catch (error) {
      console.error("[Kokushi] Attempt preview error", error);
      if (this.contentEl.contains(root)) body.createEl("p", { text: t("現在の問題を表示できませんでした。") });
    }
  }

  private async renderQuestion(body: HTMLElement, question: Question): Promise<void> {
    body.createEl("h3", { text: t("現在の問題") });
    const stem = body.createDiv({ cls: "kokushi-question" });
    await this.renderMarkdown(question.stem, stem, question.path);
    if (!this.contentEl.contains(body)) return;
    this.cleanup.push(arrangeQuestionImages(stem));
    if (question.options.length) {
      const options = body.createDiv({ cls: "kokushi-preview-options" });
      for (const option of question.options) {
        const row = options.createDiv({ cls: this.attempt.selected.includes(option.id) ? "is-selected" : "" });
        row.createSpan({ text: `${option.id}.` });
        await this.renderMarkdown(option.markdown, row.createDiv(), question.path);
        if (!this.contentEl.contains(body)) return;
      }
    }
    const expected = question.excluded ? t("採点除外") : question.answer.map(group => group.join(", ")).join(t(" または "));
    body.createEl("p", { text: t("現在の正答：{0}", expected) });
    if (question.annotation) {
      body.createEl("h4", { text: t("現在の注記") });
      await this.renderMarkdown(question.annotation, body.createDiv(), question.path);
    }
  }

  private component = new Component();

  private renderMarkdown(markdown: string, root: HTMLElement, path: string): Promise<void> {
    return MarkdownRenderer.render(this.app, markdown, root, path, this.component);
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    for (const cleanup of this.cleanup.splice(0)) cleanup();
    this.component.unload();
    this.contentEl.empty();
  }
}
