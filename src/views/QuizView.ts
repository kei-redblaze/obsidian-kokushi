
import {
  ItemView,
  MarkdownRenderer,
  Notice,
  WorkspaceLeaf,
} from "obsidian";

import {
  Question,
  Attempt,
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

type OrderMode = "sequential" | "random";

type TargetMode =
  | "all"
  | "unanswered"
  | "incorrect";

type Scope = {
  exam: string;
  section: string;
  order: OrderMode;
  target: TargetMode;
};

export class QuizView extends ItemView {
  private allQuestions: Question[] = [];
  private questions: Question[] = [];

  private index = 0;
  private selected: string[] = [];
  private graded: GradeResult | null = null;
  private saving = false;

  private quizScope: Scope = {
    exam: "all",
    section: "all",
    order: "sequential",
    target: "all",
  };

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
    this.allQuestions = [];
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
      this.allQuestions =
        await this.questionService.getQuestions();

      this.questions = [];
      this.index = 0;
      this.resetAnswer();

      await this.renderScopeSelection();
    } catch (error) {
      console.error("[Kokushi] Load error", error);

      this.contentEl.empty();

      this.contentEl.createEl("p", {
        text: "問題の読み込みに失敗しました。",
      });

      new Notice("問題の読み込みに失敗しました");
    }
  }

  // ========================================
  // 問題ID解析
  // ========================================

  private parseQuestionId(id: string): {
    exam: string;
    section: string;
    number: number;
  } | null {
    const match = id.match(
      /^(\d+)([A-F])([1-9]\d*)$/
    );

    if (!match) return null;

    return {
      exam: match[1] ?? "",
      section: match[2] ?? "",
      number: Number(match[3]),
    };
  }

  // ========================================
  // 出題範囲選択
  // ========================================

  private async renderScopeSelection(): Promise<void> {
    const container = this.contentEl;
    container.empty();

    container.createEl("p", {
      text: "解答履歴を読み込んでいます...",
    });

    let attempts: Attempt[];

    try {
      attempts =
        await this.attemptService.getAttempts();
    } catch (error) {
      console.error("[Kokushi] History error", error);

      container.empty();

      container.createEl("p", {
        text: "解答履歴の読み込みに失敗しました。",
      });

      new Notice("解答履歴の読み込みに失敗しました");
      return;
    }

    // 最後に記録された解答結果を使用
    const latestResults =
      new Map<string, boolean | null>();

    for (const attempt of attempts) {
      latestResults.set(
        attempt.id,
        attempt.correct
      );
    }

    container.empty();
    container.addClass("kokushi-quiz");

    container.createEl("h2", {
      text: "医師国家試験演習",
    });

    container.createEl("h3", {
      text: "出題範囲を選択",
    });

    // ----------------------------------------
    // 利用可能な回次
    // ----------------------------------------

    const exams = [
      ...new Set(
        this.allQuestions
          .map(q => this.parseQuestionId(q.id)?.exam)
          .filter((v): v is string => !!v)
      ),
    ].sort((a, b) => Number(b) - Number(a));

    // ----------------------------------------
    // 利用可能な問題冊子
    // ----------------------------------------

    const sections = [
      ...new Set(
        this.allQuestions
          .map(q => this.parseQuestionId(q.id)?.section)
          .filter((v): v is string => !!v)
      ),
    ].sort();

    // ----------------------------------------
    // セレクト要素生成
    // ----------------------------------------

    const createSelect = (
      label: string,
      options: Array<{
        value: string;
        text: string;
      }>,
      initialValue: string
    ): HTMLSelectElement => {
      container.createEl("h4", {
        text: label,
      });

      const select = container.createEl("select");

      for (const item of options) {
        const option = select.createEl("option", {
          text: item.text,
        });

        option.value = item.value;
      }

      select.value = initialValue;

      return select;
    };

    // 回次
    const examSelect = createSelect(
      "回次",
      [
        { value: "all", text: "すべての回次" },
        ...exams.map(exam => ({
          value: exam,
          text: `第${exam}回`,
        })),
      ],
      this.quizScope.exam
    );

    // 問題冊子
    const sectionSelect = createSelect(
      "問題冊子",
      [
        { value: "all", text: "すべて" },
        ...sections.map(section => ({
          value: section,
          text: section,
        })),
      ],
      this.quizScope.section
    );

    // 出題順序
    const orderSelect = createSelect(
      "出題順序",
      [
        {
          value: "sequential",
          text: "問題番号順",
        },
        {
          value: "random",
          text: "ランダム",
        },
      ],
      this.quizScope.order
    );

    // 出題対象
    const targetSelect = createSelect(
      "出題対象",
      [
        {
          value: "all",
          text: "全問題",
        },
        {
          value: "unanswered",
          text: "未回答問題のみ",
        },
        {
          value: "incorrect",
          text: "誤答問題のみ",
        },
      ],
      this.quizScope.target
    );

    // ========================================
    // フィルター
    // ========================================

    const getFilteredQuestions = (): Question[] => {
      return this.allQuestions.filter(question => {
        const parsed = this.parseQuestionId(
          question.id
        );

        if (!parsed) return false;

        // 回次
        if (
          this.quizScope.exam !== "all" &&
          parsed.exam !== this.quizScope.exam
        ) {
          return false;
        }

        // 問題冊子
        if (
          this.quizScope.section !== "all" &&
          parsed.section !== this.quizScope.section
        ) {
          return false;
        }

        // 未回答問題
        if (this.quizScope.target === "unanswered") {
          return !latestResults.has(question.id);
        }

        // 最新結果が誤答
        if (this.quizScope.target === "incorrect") {
          return (
            latestResults.get(question.id) === false
          );
        }

        return true;
      });
    };

    // ========================================
    // 問題数表示
    // ========================================

    const countEl = container.createEl("p", {
      cls: "kokushi-count",
    });

    const startButton = container.createEl("button", {
      text: "演習開始",
      cls: "mod-cta",
    });

    const updateCount = (): void => {
      const count = getFilteredQuestions().length;

      countEl.setText(
        `出題問題数：${count}問`
      );

      startButton.disabled = count === 0;
    };

    // ========================================
    // 選択変更イベント
    // ========================================

    examSelect.addEventListener("change", () => {
      this.quizScope.exam = examSelect.value;
      updateCount();
    });

    sectionSelect.addEventListener("change", () => {
      this.quizScope.section = sectionSelect.value;
      updateCount();
    });

    orderSelect.addEventListener("change", () => {
      this.quizScope.order =
        orderSelect.value === "random"
          ? "random"
          : "sequential";

      updateCount();
    });

    targetSelect.addEventListener("change", () => {
      const value = targetSelect.value;

      if (
        value === "all" ||
        value === "unanswered" ||
        value === "incorrect"
      ) {
        this.quizScope.target = value;
      }

      updateCount();
    });

    // ========================================
    // 演習開始
    // ========================================

    startButton.addEventListener("click", () => {
      const filtered = getFilteredQuestions();

      if (filtered.length === 0) return;

      if (this.quizScope.order === "random") {
        // Fisher-Yates shuffle
        for (
          let i = filtered.length - 1;
          i > 0;
          i--
        ) {
          const j = Math.floor(
            Math.random() * (i + 1)
          );

          const temp = filtered[i];

          filtered[i] = filtered[j]!;
          filtered[j] = temp!;
        }
      }

      this.questions = filtered;
      this.index = 0;
      this.resetAnswer();

      void this.renderQuiz();
    });

    updateCount();
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
    if (
      question.type === "single" ||
      question.type === "numeric"
    ) {
      return 1;
    }

    return question.answer[0]?.length ?? 0;
  }

  private canSubmit(question: Question): boolean {
    if (this.saving || this.graded !== null) {
      return false;
    }

    if (question.type === "numeric") {
      return (
        this.selected.length === 1 &&
        /^\d+$/.test(this.selected[0] ?? "")
      );
    }

    const required = this.getRequiredChoices(question);

    // 採点除外問題では必要選択数を
    // 正答データから取得できないため特別扱い
    if (
      question.excluded &&
      question.answer.length === 0
    ) {
      return this.selected.length > 0;
    }

    return (
      required > 0 &&
      this.selected.length === required &&
      new Set(this.selected).size === required
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
      line => line.trim() === `## ${heading}`
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

  private parseOptions(markdown: string): Option[] {
    const lines = markdown.split(/\r?\n/);
    const options: Option[] = [];

    let current: Option | null = null;

    for (const line of lines) {
      const match = line.match(
        /^\s*(?:[-*]\s+)?([a-z])[.．]\s+(.+)$/
      );

      if (match) {
        if (current) {
          options.push(current);
        }

        current = {
          id: match[1] ?? "",
          markdown: match[2] ?? "",
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
  // 問題表示
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

    const backButton = header.createEl("button", {
      text: "範囲選択に戻る",
    });

    backButton.disabled = this.saving;

    backButton.onclick = () => {
      if (this.saving) return;

      this.resetAnswer();
      void this.renderScopeSelection();
    };

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

    const submitButton = container.createEl(
      "button",
      {
        text: "解答・採点",
        cls: "mod-cta kokushi-submit",
      }
    );

    const updateSubmit = (): void => {
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
      if (!this.canSubmit(question)) return;

      // 二重送信防止
      submitButton.disabled = true;

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

    const required = this.getRequiredChoices(question);

    container.createEl("p", {
      text: question.excluded && required === 0
        ? "解答を選択してください（採点除外）。"
        : question.type === "single"
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

      textEl.createSpan().setText(
        `${option.id}. `
      );

      const markdownEl = textEl.createDiv();

      await MarkdownRenderer.render(
        this.app,
        option.markdown,
        markdownEl,
        question.path,
        this
      );

      input.addEventListener("change", () => {
        if (this.graded !== null || this.saving) {
          return;
        }

        if (question.type === "single") {
          this.selected = [option.id];
        } else {
          if (input.checked) {
            // 除外問題は正答配列が空の場合あり
            if (
              required > 0 &&
              this.selected.length >= required
            ) {
              input.checked = false;
              return;
            }

            if (!this.selected.includes(option.id)) {
              this.selected.push(option.id);
            }
          } else {
            this.selected = this.selected.filter(
              id => id !== option.id
            );
          }
        }

        // UIのチェック状態を同期
        for (const item of inputs) {
          item.checked =
            this.selected.includes(item.value);
        }

        updateSubmit();
      });
    }
  }

  // ========================================
  // 数値解答
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
      if (this.graded !== null || this.saving) {
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
  // 採点・履歴保存
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
      this.saving = false;

      await this.renderQuiz();
    } catch (error) {
      console.error(
        "[Kokushi] Attempt save error",
        error
      );

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
  // 次の問題
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
        text: "問題がありません。",
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

    restartButton.onclick = () => {
      this.index = 0;
      this.resetAnswer();

      void this.renderQuiz();
    };

    const scopeButton = container.createEl(
      "button",
      {
        text: "出題範囲を選び直す",
      }
    );

    scopeButton.onclick = () => {
      this.resetAnswer();
      void this.renderScopeSelection();
    };
  }

  // ========================================
  // ダッシュボードからの演習開始
  // ========================================

  public async startFromDashboard(
    target: "unanswered" | "incorrect"
  ): Promise<void> {
    await this.loadQuestions();

    const attempts =
      await this.attemptService.getAttempts();

    const latestResults =
      new Map<string, boolean | null>();

    for (const attempt of attempts) {
      latestResults.set(
        attempt.id,
        attempt.correct
      );
    }

    this.quizScope = {
      exam: "all",
      section: "all",
      order: "sequential",
      target,
    };

    this.questions = this.allQuestions.filter(
      question => {
        if (target === "unanswered") {
          return !latestResults.has(question.id);
        }

        return (
          latestResults.get(question.id) === false
        );
      }
    );

    this.index = 0;
    this.resetAnswer();

    await this.renderQuiz();
  }

  // ========================================
  // ダッシュボードから個別問題を開く
  // ========================================

  public async openQuestionFromDashboard(
    id: string
  ): Promise<void> {
    await this.loadQuestions();

    const question = this.allQuestions.find(
      item => item.id === id
    );

    if (!question) {
      new Notice(
        `問題 ${id} が見つかりません`
      );
      return;
    }

    this.quizScope = {
      exam: "all",
      section: "all",
      order: "sequential",
      target: "all",
    };

    this.questions = [question];
    this.index = 0;
    this.resetAnswer();

    await this.renderQuiz();
  }
}
