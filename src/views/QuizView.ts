
import {
  ItemView,
  MarkdownRenderer,
  Notice,
  WorkspaceLeaf,
} from "obsidian";

import {
  Question,
  GradeResult,
} from "../types";

import { QuestionService } from "../services/QuestionService";
import { GradingService } from "../services/GradingService";
import { AttemptService } from "../services/AttemptService";

export const VIEW_TYPE_KOKUSHI = "kokushi-quiz";

type Option = {
  id: string;
  markdown: string;
};

export class QuizView extends ItemView {
  private questions: Question[] = [];
  private index = 0;

  private selected: string[] = [];
  private graded: GradeResult | null = null;
  private saving = false;

  constructor(
    leaf: WorkspaceLeaf,
    private questionService: QuestionService,
    private attemptService: AttemptService
  ) {
    super(leaf);
  }

  // ========================================
  // View
  // ========================================

  getViewType(): string {
    return VIEW_TYPE_KOKUSHI;
  }

  getDisplayText(): string {
    return "国試演習";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen(): Promise<void> {
    await this.loadQuestions();
  }

  async onClose(): Promise<void> {
    this.questions = [];
  }

  // ========================================
  // 問題読み込み
  // ========================================

  private async loadQuestions(): Promise<void> {
    this.contentEl.empty();

    this.contentEl.createEl("p", {
      text: "問題を読み込んでいます...",
    });

    try {
      this.questions =
        await this.questionService.getQuestions();

      this.index = 0;
      this.resetAnswer();

      await this.renderQuiz();
    } catch (error) {
      console.error(error);

      this.contentEl.empty();
      this.contentEl.createEl("p", {
        text: "問題の読み込みに失敗しました。",
      });

      new Notice("問題の読み込みに失敗しました");
    }
  }

  // ========================================
  // 状態管理
  // ========================================

  private resetAnswer(): void {
    this.selected = [];
    this.graded = null;
    this.saving = false;
  }

  private getCurrentQuestion(): Question | null {
    return this.questions[this.index] ?? null;
  }

  private getRequiredChoices(
    question: Question
  ): number {
    if (question.type === "single") {
      return 1;
    }

    if (question.type === "numeric") {
      return 1;
    }

    return question.answer[0]?.length ?? 0;
  }

  private canSubmit(question: Question): boolean {
    if (this.saving || this.graded !== null) {
      return false;
    }

    const required = this.getRequiredChoices(
      question
    );

    if (question.type === "numeric") {
      return (
        this.selected.length === 1 &&
        /^\d+$/.test(this.selected[0])
      );
    }

    return (
      required > 0 &&
      this.selected.length === required
    );
  }

  // ========================================
  // Markdown解析
  // ========================================

  private getSection(
    markdown: string,
    heading: string
  ): string {
    const lines = markdown.split(/\r?\n/);

    const start = lines.findIndex(
      line =>
        line.trim() === `## ${heading}`
    );

    if (start === -1) {
      return "";
    }

    const result: string[] = [];

    for (
      let i = start + 1;
      i < lines.length;
      i++
    ) {
      if (/^#{1,2}\s+/.test(lines[i])) {
        break;
      }

      result.push(lines[i]);
    }

    return result.join("\n").trim();
  }

  private parseOptions(
    markdown: string
  ): Option[] {
    const lines = markdown.split(/\r?\n/);
    const options: Option[] = [];

    let current: Option | null = null;

    for (const line of lines) {
      const match = line.match(
        /^\s*(?:[-*]\s+)?([a-z])[\.\．]\s+(.+)$/
      );

      if (match) {
        if (current) {
          options.push(current);
        }

        current = {
          id: match[1],
          markdown: match[2],
        };
      } else if (current) {
        current.markdown += "\n" + line;
      }
    }

    if (current) {
      options.push(current);
    }

    return options;
  }

  // ========================================
  // メイン画面描画
  // ========================================

  private async renderQuiz(): Promise<void> {
    const container = this.contentEl;
    container.empty();

    container.addClass("kokushi-quiz");

    const question = this.getCurrentQuestion();

    if (!question) {
      this.renderFinished(container);
      return;
    }

    // ヘッダー
    const header = container.createDiv({
      cls: "kokushi-header",
    });

    header.createEl("h2", {
      text: "医師国家試験演習",
    });

    header.createEl("p", {
      text:
        `${question.id} ` +
        `(${this.index + 1} / ${this.questions.length})`,
    });

    // 問題文
    const questionMarkdown = this.getSection(
      question.markdown,
      "Question"
    );

    const questionEl = container.createDiv({
      cls: "kokushi-question",
    });

    if (questionMarkdown) {
      await MarkdownRenderer.render(
        this.app,
        questionMarkdown,
        questionEl,
        question.path,
        this
      );
    } else {
      questionEl.createEl("p", {
        text: "問題文が見つかりません。",
      });
    }

    // 解答エリア
    const answerEl = container.createDiv({
      cls: "kokushi-answer",
    });

    // 採点ボタン
    const submitButton = container.createEl(
      "button",
      {
        text: "解答・採点",
        cls: "mod-cta kokushi-submit",
      }
    );

    // 入力時に採点ボタンを更新
    const updateSubmit = () => {
      submitButton.disabled =
        !this.canSubmit(question);
    };

    if (question.type === "numeric") {
      this.renderNumericInput(
        answerEl,
        question,
        updateSubmit
      );
    } else {
      const optionsMarkdown = this.getSection(
        question.markdown,
        "Options"
      );

      await this.renderOptions(
        answerEl,
        question,
        optionsMarkdown,
        updateSubmit
      );
    }

    updateSubmit();

    submitButton.onclick = async () => {
      await this.submitAnswer(question);
    };

    // 採点後
    if (this.graded !== null) {
      submitButton.remove();

      this.renderResult(container, question);
      this.renderNavigation(container);
    }
  }

  // ========================================
  // 選択式問題
  // ========================================

  private async renderOptions(
    container: HTMLElement,
    question: Question,
    markdown: string,
    updateSubmit: () => void
  ): Promise<void> {
    const options = this.parseOptions(markdown);

    if (options.length === 0) {
      container.createEl("p", {
        text: "選択肢が見つかりません。",
      });
      return;
    }

    const required = this.getRequiredChoices(
      question
    );

    container.createEl("p", {
      text:
        question.type === "single"
          ? "1つ選択してください。"
          : `${required}つ選択してください。`,
    });

    const inputs: HTMLInputElement[] = [];

    for (const option of options) {
      const label = container.createEl("label", {
        cls: "kokushi-option",
      });

      const input = label.createEl("input", {
        type:
          question.type === "single"
            ? "radio"
            : "checkbox",
      });

      input.name = "kokushi-choice";
      input.value = option.id;
      input.checked =
        this.selected.includes(option.id);

      input.disabled = this.graded !== null;

      inputs.push(input);

      const textEl = label.createDiv({
        cls: "kokushi-option-text",
      });

      textEl.createEl("span", {
        text: `${option.id}. `,
      });

      const markdownEl = textEl.createDiv();

      await MarkdownRenderer.render(
        this.app,
        option.markdown,
        markdownEl,
        question.path,
        this
      );

      input.addEventListener("change", () => {
        if (this.graded !== null) {
          return;
        }

        if (question.type === "single") {
          this.selected = [option.id];
        } else {
          if (input.checked) {
            if (this.selected.length >= required) {
              input.checked = false;
              return;
            }

            this.selected.push(option.id);
          } else {
            this.selected = this.selected.filter(
              id => id !== option.id
            );
          }
        }

        // UIと内部状態を同期
        for (const item of inputs) {
          item.checked = this.selected.includes(
            item.value
          );
        }

        updateSubmit();
      });
    }
  }

  // ========================================
  // 数値解答問題
  // ========================================

  private renderNumericInput(
    container: HTMLElement,
    question: Question,
    updateSubmit: () => void
  ): void {
    container.createEl("p", {
      text: "数値を入力してください。",
    });

    const input = container.createEl("input", {
      type: "text",
      placeholder: "数値",
      cls: "kokushi-numeric-input",
    });

    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.value = this.selected[0] ?? "";
    input.disabled = this.graded !== null;

    input.addEventListener("input", () => {
      if (this.graded !== null) {
        return;
      }

      const value = input.value.trim();

      this.selected = /^\d+$/.test(value)
        ? [value]
        : [];

      updateSubmit();
    });
  }

  // ========================================
  // 解答確定・履歴保存
  // ========================================

  private async submitAnswer(
    question: Question
  ): Promise<void> {
    if (!this.canSubmit(question)) {
      return;
    }

    this.saving = true;

    const selected = [...this.selected];

    const result = GradingService.grade(
      question,
      selected
    );

    try {
      await this.attemptService.save({
        id: question.id,
        timestamp: new Date().toISOString(),
        selected,
        correct:
          result === "excluded"
            ? null
            : result === "correct",
      });

      this.graded = result;

      await this.renderQuiz();
    } catch (error) {
      console.error(error);

      this.saving = false;

      new Notice(
        "解答履歴を保存できませんでした。"
      );

      await this.renderQuiz();
    }
  }

  // ========================================
  // 採点結果
  // ========================================

  private renderResult(
    container: HTMLElement,
    question: Question
  ): void {
    if (this.graded === null) {
      return;
    }

    const resultEl = container.createDiv({
      cls: "kokushi-result",
    });

    const labels: Record<GradeResult, string> = {
      correct: "正解",
      incorrect: "不正解",
      excluded: "採点除外",
    };

    resultEl.createEl("h3", {
      text: labels[this.graded],
    });

    if (question.excluded) {
      resultEl.createEl("p", {
        text: "この問題は採点対象外です。",
      });

      return;
    }

    const answers = question.answer
      .map(set =>
        question.type === "numeric"
          ? set.join("")
          : set.join(", ")
      )
      .join(" または ");

    resultEl.createEl("p", {
      text: `正答：${answers}`,
    });
  }

  // ========================================
  // ナビゲーション
  // ========================================

  private renderNavigation(
    container: HTMLElement
  ): void {
    const nav = container.createDiv({
      cls: "kokushi-navigation",
    });

    const nextButton = nav.createEl("button", {
      text:
        this.index + 1 < this.questions.length
          ? "次の問題"
          : "演習終了",
    });

    nextButton.onclick = async () => {
      this.index++;
      this.resetAnswer();

      await this.renderQuiz();
    };
  }

  // ========================================
  // 演習終了
  // ========================================

  private renderFinished(
    container: HTMLElement
  ): void {
    container.createEl("h2", {
      text: "国試演習",
    });

    if (this.questions.length === 0) {
      container.createEl("p", {
        text: "問題データが見つかりません。",
      });
    } else {
      container.createEl("p", {
        text: "すべての問題が終了しました。",
      });
    }

    const restartButton = container.createEl(
      "button",
      {
        text: "最初から演習する",
      }
    );

    restartButton.onclick = async () => {
      this.index = 0;
      this.resetAnswer();

      await this.renderQuiz();
    };
  }
}
