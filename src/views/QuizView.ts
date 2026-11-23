
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

// ========================================
// 型定義
// ========================================

type Option = {
  id: string;
  markdown: string;
};

type OrderMode = "sequential" | "random";

type TargetMode =
  | "all"
  | "unanswered"
  | "incorrect";

type CountMode = "all" | "ten" | "custom";

type QuizScope = {
  // null: 全回次
  // []: 選択なし
  exams: string[] | null;

  section: string;
  order: OrderMode;
  target: TargetMode;

  countMode: CountMode;
  customCount: string;
};

type ParsedQuestionId = {
  exam: string;
  section: string;
  number: number;
};

// ========================================
// QuizView
// ========================================

export class QuizView extends ItemView {

  // ----------------------------------------
  // 問題データ
  // ----------------------------------------

  private allQuestions: Question[] = [];
  private questions: Question[] = [];

  private index = 0;

  // ----------------------------------------
  // 解答状態
  // ----------------------------------------

  private selected: string[] = [];
  private graded: GradeResult | null = null;
  private saving = false;

  // ----------------------------------------
  // 出題条件
  // ItemView.scopeとの名前衝突を回避
  // ----------------------------------------

  private quizScope: QuizScope = {
    exams: null,
    section: "all",
    order: "sequential",
    target: "all",
    countMode: "all",
    customCount: "25",
  };

  constructor(
    leaf: WorkspaceLeaf,
    private questionService: QuestionService,
    private attemptService: AttemptService
  ) {
    super(leaf);
  }

  // ========================================
  // View基本設定
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
      console.error(
        "[Kokushi] Question load error",
        error
      );

      this.contentEl.empty();

      this.contentEl.createEl("p", {
        text: "問題の読み込みに失敗しました。",
      });

      new Notice(
        "問題の読み込みに失敗しました"
      );
    }
  }

  // ========================================
  // 問題ID解析
  // ========================================

  private parseQuestionId(
    id: string
  ): ParsedQuestionId | null {

    const match = id.match(
      /^(\d+)([A-F])([1-9]\d*)$/
    );

    if (!match) {
      return null;
    }

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
      console.error(
        "[Kokushi] History load error",
        error
      );

      container.empty();

      container.createEl("p", {
        text: "解答履歴の読み込みに失敗しました。",
      });

      new Notice(
        "解答履歴の読み込みに失敗しました"
      );

      return;
    }

    // ========================================
    // 問題ごとの最新解答結果
    // ========================================

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

    // ========================================
    // 利用可能な回次
    // ========================================

    const exams = [
      ...new Set(
        this.allQuestions
          .map(
            question =>
              this.parseQuestionId(
                question.id
              )?.exam
          )
          .filter(
            (value): value is string =>
              !!value
          )
      ),
    ].sort(
      (a, b) => Number(b) - Number(a)
    );

    // ========================================
    // 利用可能な問題冊子
    // ========================================

    const sections = [
      ...new Set(
        this.allQuestions
          .map(
            question =>
              this.parseQuestionId(
                question.id
              )?.section
          )
          .filter(
            (value): value is string =>
              !!value
          )
      ),
    ].sort();

    // 存在しない回次を選択状態から除外
    if (this.quizScope.exams !== null) {
      this.quizScope.exams =
        this.quizScope.exams.filter(
          exam => exams.includes(exam)
        );
    }

    // ========================================
    // 回次の複数選択
    // ========================================

    const examHeader = container.createDiv({
      cls: "kokushi-scope-header",
    });

    examHeader.createEl("h4", {
      text: "回次（複数選択可）",
    });

    const selectAllButton =
      examHeader.createEl("button", {
        text: "すべて選択",
      });

    const examContainer =
      container.createDiv({
        cls: "kokushi-exam-checkboxes",
      });

    const examCheckboxes =
      new Map<string, HTMLInputElement>();

    const syncExamCheckboxes = (): void => {

      for (
        const [exam, input]
        of examCheckboxes
      ) {
        input.checked =
          this.quizScope.exams === null ||
          this.quizScope.exams.includes(exam);
      }
    };

    for (const exam of exams) {

      const label =
        examContainer.createEl("label", {
          cls: "kokushi-exam-checkbox",
        });

      const input = label.createEl("input", {
        type: "checkbox",
      });

      label.createSpan().setText(
        `第${exam}回`
      );

      examCheckboxes.set(exam, input);

      input.addEventListener(
        "change",
        () => {

          const selected =
            this.quizScope.exams === null
              ? [...exams]
              : [...this.quizScope.exams];

          if (input.checked) {

            if (!selected.includes(exam)) {
              selected.push(exam);
            }

          } else {

            const index =
              selected.indexOf(exam);

            if (index >= 0) {
              selected.splice(index, 1);
            }
          }

          this.quizScope.exams =
            selected.length === exams.length
              ? null
              : selected;

          syncExamCheckboxes();
          updateCount();
        }
      );
    }

    selectAllButton.onclick = () => {
      this.quizScope.exams = null;

      syncExamCheckboxes();
      updateCount();
    };

    syncExamCheckboxes();

    // ========================================
    // セレクト要素の共通生成
    // ========================================

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

      const select =
        container.createEl("select");

      for (const item of options) {

        const option =
          select.createEl("option", {
            text: item.text,
          });

        option.value = item.value;
      }

      select.value = initialValue;

      return select;
    };

    // ========================================
    // 問題冊子
    // ========================================

    const sectionSelect = createSelect(
      "問題冊子",
      [
        {
          value: "all",
          text: "すべて",
        },
        ...sections.map(
          section => ({
            value: section,
            text: section,
          })
        ),
      ],
      this.quizScope.section
    );

    // ========================================
    // 出題順序
    // ========================================

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

    // ========================================
    // 出題対象
    // ========================================

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
    // 出題問題数
    // ========================================

    container.createEl("h4", {
      text: "出題問題数",
    });

    const countSelect =
      container.createEl("select");

    const countOptions: Array<{
      value: CountMode;
      text: string;
    }> = [
      {
        value: "all",
        text: "すべて",
      },
      {
        value: "ten",
        text: "10問",
      },
      {
        value: "custom",
        text: "任意の問題数",
      },
    ];

    for (const item of countOptions) {

      const option =
        countSelect.createEl("option", {
          text: item.text,
        });

      option.value = item.value;
    }

    countSelect.value =
      this.quizScope.countMode;

    // ----------------------------------------
    // 任意の問題数入力
    // ----------------------------------------

    const customContainer =
      container.createDiv({
        cls: "kokushi-custom-count",
      });

    const customInput =
      customContainer.createEl("input", {
        type: "text",
        placeholder: "例：25",
      });

    customInput.inputMode = "numeric";
    customInput.value =
      this.quizScope.customCount;

    customContainer.createSpan().setText(
      "問"
    );

    const errorEl =
      container.createEl("p", {
        cls: "kokushi-count-error",
      });

    // ========================================
    // 出題条件による絞り込み
    // ========================================

    const getFilteredQuestions = (): Question[] => {

      return this.allQuestions.filter(
        question => {

          const parsed =
            this.parseQuestionId(
              question.id
            );

          if (!parsed) {
            return false;
          }

          // --------------------------------
          // 回次
          // --------------------------------

          if (
            this.quizScope.exams !== null &&
            !this.quizScope.exams.includes(
              parsed.exam
            )
          ) {
            return false;
          }

          // --------------------------------
          // 問題冊子
          // --------------------------------

          if (
            this.quizScope.section !== "all" &&
            parsed.section !==
              this.quizScope.section
          ) {
            return false;
          }

          // --------------------------------
          // 未回答問題のみ
          // --------------------------------

          if (
            this.quizScope.target ===
            "unanswered"
          ) {
            return !latestResults.has(
              question.id
            );
          }

          // --------------------------------
          // 誤答問題のみ
          // --------------------------------

          if (
            this.quizScope.target ===
            "incorrect"
          ) {
            return (
              latestResults.get(
                question.id
              ) === false
            );
          }

          return true;
        }
      );
    };

    // ========================================
    // 出題数の検証
    // ========================================

    const getRequestedCount = (
      available: number
    ): number | null => {

      if (
        this.quizScope.countMode ===
        "all"
      ) {
        return available;
      }

      if (
        this.quizScope.countMode ===
        "ten"
      ) {
        return 10;
      }

      const value =
        this.quizScope.customCount.trim();

      // 1以上の整数のみ許可
      if (!/^[1-9]\d*$/.test(value)) {
        return null;
      }

      const count = Number(value);

      if (
        !Number.isSafeInteger(count)
      ) {
        return null;
      }

      return count;
    };

    // ========================================
    // 出題数表示
    // ========================================

    const countEl =
      container.createEl("p", {
        cls: "kokushi-count",
      });

    const startButton =
      container.createEl("button", {
        text: "演習開始",
        cls: "mod-cta",
      });

    const updateCount = (): void => {

      const available =
        getFilteredQuestions().length;

      const requested =
        getRequestedCount(available);

      customContainer.style.display =
        this.quizScope.countMode ===
        "custom"
          ? "flex"
          : "none";

      errorEl.setText("");

      if (requested === null) {

        countEl.setText(
          `条件一致：${available}問`
        );

        errorEl.setText(
          "1以上の整数を入力してください。"
        );

        startButton.disabled = true;
        return;
      }

      const actual = Math.min(
        requested,
        available
      );

      countEl.setText(
        `条件一致：${available}問 / ` +
        `出題：${actual}問`
      );

      if (
        requested > available &&
        available > 0
      ) {
        errorEl.setText(
          "指定数を満たさないため、" +
          "対象の全問題を出題します。"
        );
      }

      startButton.disabled =
        actual === 0;
    };

    // ========================================
    // 各種イベント
    // ========================================

    sectionSelect.addEventListener(
      "change",
      () => {
        this.quizScope.section =
          sectionSelect.value;

        updateCount();
      }
    );

    orderSelect.addEventListener(
      "change",
      () => {

        this.quizScope.order =
          orderSelect.value === "random"
            ? "random"
            : "sequential";

        updateCount();
      }
    );

    targetSelect.addEventListener(
      "change",
      () => {

        const value =
          targetSelect.value;

        if (
          value === "all" ||
          value === "unanswered" ||
          value === "incorrect"
        ) {
          this.quizScope.target = value;
        }

        updateCount();
      }
    );

    countSelect.addEventListener(
      "change",
      () => {

        const value =
          countSelect.value;

        if (
          value === "all" ||
          value === "ten" ||
          value === "custom"
        ) {
          this.quizScope.countMode = value;
        }

        updateCount();
      }
    );

    customInput.addEventListener(
      "input",
      () => {

        this.quizScope.customCount =
          customInput.value;

        updateCount();
      }
    );

    // ========================================
    // 演習開始
    // ========================================

    startButton.addEventListener(
      "click",
      () => {

        const filtered =
          getFilteredQuestions();

        const requested =
          getRequestedCount(
            filtered.length
          );

        if (
          requested === null ||
          filtered.length === 0
        ) {
          return;
        }

        // --------------------------------
        // ランダム出題
        // Fisher-Yates
        // --------------------------------

        if (
          this.quizScope.order ===
          "random"
        ) {

          for (
            let i = filtered.length - 1;
            i > 0;
            i--
          ) {

            const j = Math.floor(
              Math.random() * (i + 1)
            );

            const temp = filtered[i];

            filtered[i] =
              filtered[j]!;

            filtered[j] =
              temp!;
          }
        }

        // --------------------------------
        // 問題数を制限
        // --------------------------------

        const actual = Math.min(
          requested,
          filtered.length
        );

        this.questions =
          filtered.slice(0, actual);

        this.index = 0;
        this.resetAnswer();

        void this.renderQuiz();
      }
    );

    // 初期表示
    updateCount();
  }

  // ========================================
  // 解答状態の管理
  // ========================================

  private resetAnswer(): void {
    this.selected = [];
    this.graded = null;
    this.saving = false;
  }

  private getCurrentQuestion(): Question | null {
    return this.questions[this.index] ?? null;
  }

  // ========================================
  // 必要選択数
  // ========================================

  private getRequiredChoices(
    question: Question
  ): number {

    if (
      question.type === "single" ||
      question.type === "numeric"
    ) {
      return 1;
    }

    return (
      question.answer[0]?.length ?? 0
    );
  }

  // ========================================
  // 解答可能判定
  // ========================================

  private canSubmit(
    question: Question
  ): boolean {

    if (
      this.saving ||
      this.graded !== null
    ) {
      return false;
    }

    // ----------------------------------------
    // 数値解答
    // ----------------------------------------

    if (
      question.type === "numeric"
    ) {
      return (
        this.selected.length === 1 &&
        /^\d+$/.test(
          this.selected[0] ?? ""
        )
      );
    }

    // ----------------------------------------
    // 採点除外問題
    // ----------------------------------------

    if (
      question.excluded &&
      question.answer.length === 0
    ) {
      return (
        this.selected.length > 0
      );
    }

    // ----------------------------------------
    // 通常の選択式問題
    // ----------------------------------------

    const required =
      this.getRequiredChoices(question);

    return (
      required > 0 &&
      this.selected.length === required &&
      new Set(this.selected).size ===
        required
    );
  }

  // ========================================
  // Markdownのセクション取得
  // ========================================

  private getSection(
    markdown: string,
    heading: string
  ): string {

    const lines =
      markdown.split(/\r?\n/);

    const start =
      lines.findIndex(
        line =>
          line.trim() ===
          `## ${heading}`
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

      const line = lines[i] ?? "";

      if (
        /^#{1,2}\s+/.test(line)
      ) {
        break;
      }

      result.push(line);
    }

    return result.join("\n").trim();
  }

  // ========================================
  // 選択肢の解析
  // ========================================

  private parseOptions(
    markdown: string
  ): Option[] {

    const lines =
      markdown.split(/\r?\n/);

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

        current.markdown +=
          "\n" + line;
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

    const question =
      this.getCurrentQuestion();

    if (!question) {
      this.renderFinished(container);
      return;
    }

    // ========================================
    // ヘッダー
    // ========================================

    const header =
      container.createDiv({
        cls: "kokushi-header",
      });

    header.createEl("h2", {
      text: "医師国家試験演習",
    });

    header.createEl("p", {
      text:
        `${question.id} ` +
        `(${this.index + 1} / ` +
        `${this.questions.length})`,
    });

    // ----------------------------------------
    // 範囲選択へ戻る
    // ----------------------------------------

    const backButton =
      header.createEl("button", {
        text: "範囲選択に戻る",
      });

    backButton.disabled =
      this.saving;

    backButton.onclick = () => {

      if (this.saving) {
        return;
      }

      this.resetAnswer();

      void this.renderScopeSelection();
    };

    // ========================================
    // 問題文表示
    // ========================================

    const questionMarkdown =
      this.getSection(
        question.markdown,
        "Question"
      );

    const questionEl =
      container.createDiv({
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

    // ========================================
    // 解答エリア
    // ========================================

    const answerEl =
      container.createDiv({
        cls: "kokushi-answer",
      });

    const submitButton =
      container.createEl("button", {
        text: "解答・採点",
        cls: "mod-cta kokushi-submit",
      });

    const updateSubmit = (): void => {
      submitButton.disabled =
        !this.canSubmit(question);
    };

    // ----------------------------------------
    // 数値問題
    // ----------------------------------------

    if (
      question.type === "numeric"
    ) {

      this.renderNumericInput(
        answerEl,
        question,
        updateSubmit
      );

    } else {

      // ------------------------------------
      // 選択式問題
      // ------------------------------------

      const optionsMarkdown =
        this.getSection(
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

    // ========================================
    // 採点ボタン
    // ========================================

    submitButton.onclick = async () => {

      if (!this.canSubmit(question)) {
        return;
      }

      submitButton.disabled = true;

      await this.submitAnswer(question);
    };

    // ========================================
    // 採点済みの場合
    // ========================================

    if (this.graded !== null) {

      submitButton.remove();

      this.renderResult(
        container,
        question
      );

      this.renderNavigation(
        container
      );
    }
  }

  // ========================================
  // 選択式問題の表示
  // ========================================

  private async renderOptions(
    container: HTMLElement,
    question: Question,
    markdown: string,
    updateSubmit: () => void
  ): Promise<void> {

    const options =
      this.parseOptions(markdown);

    if (options.length === 0) {

      container.createEl("p", {
        text: "選択肢が見つかりません。",
      });

      return;
    }

    const required =
      this.getRequiredChoices(question);

    // ========================================
    // 選択数ガイド
    // ========================================

    const guide =
      question.excluded &&
      question.answer.length === 0
        ? "解答を選択してください（採点除外）。"
        : question.type === "single"
          ? "1つ選択してください。"
          : `${required}つ選択してください。`;

    container.createEl("p", {
      text: guide,
    });

    const inputs: HTMLInputElement[] = [];

    // ========================================
    // 選択肢生成
    // ========================================

    for (const option of options) {

      const label =
        container.createEl("label", {
          cls: "kokushi-option",
        });

      const input =
        label.createEl("input", {
          type:
            question.type === "single"
              ? "radio"
              : "checkbox",
        });

      input.name = "kokushi-choice";
      input.value = option.id;

      input.checked =
        this.selected.includes(
          option.id
        );

      input.disabled =
        this.graded !== null;

      inputs.push(input);

      // ------------------------------------
      // 選択肢テキスト
      // ------------------------------------

      const textEl =
        label.createDiv({
          cls: "kokushi-option-text",
        });

      textEl.createSpan().setText(
        `${option.id}. `
      );

      const markdownEl =
        textEl.createDiv();

      await MarkdownRenderer.render(
        this.app,
        option.markdown,
        markdownEl,
        question.path,
        this
      );

      // ====================================
      // 選択変更
      // ====================================

      input.addEventListener(
        "change",
        () => {

          if (
            this.graded !== null ||
            this.saving
          ) {
            return;
          }

          // --------------------------------
          // 単一選択
          // --------------------------------

          if (
            question.type === "single"
          ) {

            this.selected = [
              option.id
            ];

          } else {

            // ------------------------------
            // 複数選択
            // ------------------------------

            if (input.checked) {

              if (
                required > 0 &&
                this.selected.length >=
                  required
              ) {
                input.checked = false;
                return;
              }

              if (
                !this.selected.includes(
                  option.id
                )
              ) {
                this.selected.push(
                  option.id
                );
              }

            } else {

              this.selected =
                this.selected.filter(
                  id => id !== option.id
                );
            }
          }

          // --------------------------------
          // チェック状態同期
          // --------------------------------

          for (const item of inputs) {

            item.checked =
              this.selected.includes(
                item.value
              );
          }

          updateSubmit();
        }
      );
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

    const input =
      container.createEl("input", {
        type: "text",
        placeholder: "数値",
        cls: "kokushi-numeric-input",
      });

    input.inputMode = "numeric";
    input.autocomplete = "off";

    input.value =
      this.selected[0] ?? "";

    input.disabled =
      this.graded !== null;

    input.addEventListener(
      "input",
      () => {

        if (
          this.graded !== null ||
          this.saving
        ) {
          return;
        }

        const value =
          input.value.trim();

        this.selected =
          /^\d+$/.test(value)
            ? [value]
            : [];

        updateSubmit();
      }
    );
  }

  // ========================================
  // 採点・解答履歴保存
  // ========================================

  private async submitAnswer(
    question: Question
  ): Promise<void> {

    if (!this.canSubmit(question)) {
      return;
    }

    this.saving = true;

    const selected = [
      ...this.selected
    ];

    const result =
      GradingService.grade(
        question,
        selected
      );

    try {

      await this.attemptService.save({
        id: question.id,
        timestamp:
          new Date().toISOString(),
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
  // 採点結果の表示
  // ========================================

  private renderResult(
    container: HTMLElement,
    question: Question
  ): void {

    if (this.graded === null) {
      return;
    }

    const resultEl =
      container.createDiv({
        cls: "kokushi-result",
      });

    const labels: Record<
      GradeResult,
      string
    > = {
      correct: "正解",
      incorrect: "不正解",
      excluded: "採点除外",
    };

    resultEl.createEl("h3", {
      text: labels[this.graded],
    });

    // ----------------------------------------
    // 採点除外
    // ----------------------------------------

    if (question.excluded) {

      resultEl.createEl("p", {
        text:
          "この問題は採点対象外です。",
      });

      return;
    }

    // ----------------------------------------
    // 正答表示
    // ----------------------------------------

    const answers =
      question.answer
        .map(
          set =>
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
  // 次の問題へ移動
  // ========================================

  private renderNavigation(
    container: HTMLElement
  ): void {

    const nav =
      container.createDiv({
        cls: "kokushi-navigation",
      });

    const nextButton =
      nav.createEl("button", {
        text:
          this.index + 1 <
          this.questions.length
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
  // 演習終了画面
  // ========================================

  private renderFinished(
    container: HTMLElement
  ): void {

    container.createEl("h2", {
      text: "国試演習",
    });

    if (
      this.questions.length === 0
    ) {

      container.createEl("p", {
        text: "問題がありません。",
      });

    } else {

      container.createEl("p", {
        text:
          "すべての問題が終了しました。",
      });
    }

    // ----------------------------------------
    // 同じ問題セットでもう一度
    // ----------------------------------------

    const restartButton =
      container.createEl("button", {
        text: "最初から演習する",
      });

    restartButton.disabled =
      this.questions.length === 0;

    restartButton.onclick = () => {

      this.index = 0;
      this.resetAnswer();

      void this.renderQuiz();
    };

    // ----------------------------------------
    // 出題範囲へ戻る
    // ----------------------------------------

    const scopeButton =
      container.createEl("button", {
        text: "出題範囲を選び直す",
      });

    scopeButton.onclick = () => {

      this.resetAnswer();

      void this.renderScopeSelection();
    };
  }

  // ========================================
  // ダッシュボードから演習開始
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

    // ----------------------------------------
    // 全回次・全冊子を対象
    // ----------------------------------------

    this.quizScope = {
      exams: null,
      section: "all",
      order: "sequential",
      target,
      countMode: "all",
      customCount: "25",
    };

    // ----------------------------------------
    // 対象問題抽出
    // ----------------------------------------

    this.questions =
      this.allQuestions.filter(
        question => {

          if (
            target === "unanswered"
          ) {
            return !latestResults.has(
              question.id
            );
          }

          return (
            latestResults.get(
              question.id
            ) === false
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

    const question =
      this.allQuestions.find(
        item => item.id === id
      );

    if (!question) {

      new Notice(
        `問題 ${id} が見つかりません`
      );

      return;
    }

    // ----------------------------------------
    // 出題条件をリセット
    // ----------------------------------------

    this.quizScope = {
      exams: null,
      section: "all",
      order: "sequential",
      target: "all",
      countMode: "all",
      customCount: "25",
    };

    // ----------------------------------------
    // 指定された1問のみ表示
    // ----------------------------------------

    this.questions = [
      question
    ];

    this.index = 0;
    this.resetAnswer();

    await this.renderQuiz();
  }
}
