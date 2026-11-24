
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
  SessionResult,
  SessionRecord,
} from "../types";

import { QuestionService } from "../services/QuestionService";
import { QuestionStudyService } from "../services/QuestionStudyService";
import { GradingService } from "../services/GradingService";
import { AttemptService } from "../services/AttemptService";
import { SessionService } from "../services/SessionService";
import { QUESTION_ID_PATTERN } from "../constants";
import { renderDraftList } from "./DraftList";
import { renderQuestionStudy } from "./QuestionStudyPanel";

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
  exams: string[] | null;
  order: OrderMode;
  target: TargetMode;
  countMode: CountMode;
  customCount: string;
};

type QuestionState = {
  selected: string[];
  graded: GradeResult | null;
  unknown: boolean;
};

// ========================================
// QuizView
// ========================================

export class QuizView extends ItemView {
  // ========================================
  // 問題データ
  // ========================================

  private allQuestions: Question[] = [];
  private questions: Question[] = [];
  private index = 0;

  // ========================================
  // 現在の解答状態
  // ========================================

  private selected: string[] = [];
  private unknown = false;
  private graded: GradeResult | null = null;
  private saving = false;
  private session: Pick<SessionRecord, "id" | "startedAt" | "scope" | "sourceSessionId"> | null = null;
  private sessionCompleted = false;
  private draftDirty = false;
  private draftTimer: number | null = null;
  private draftWrite = Promise.resolve(true);
  private draftErrorShown = false;
  private pendingOperation: Promise<void> | null = null;
  private closing = false;

  // ========================================
  // セッション内の解答状態
  // ========================================

  private questionStates = new Map<
    number,
    QuestionState
  >();

  // ========================================
  // 出題条件
  // ItemView.scopeとの名前衝突を回避
  // ========================================

  private quizScope: QuizScope = {
    exams: null,
    order: "sequential",
    target: "all",
    countMode: "all",
    customCount: "25",
  };

  constructor(
    leaf: WorkspaceLeaf,
    private questionService: QuestionService,
    private attemptService: AttemptService,
    private sessionService: SessionService,
    private studyService: QuestionStudyService
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
    return "演習";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen(): Promise<void> {
    this.closing = false;
    await this.loadQuestions();
  }

  async onClose(): Promise<void> {
    this.closing = true;
    await this.pendingOperation?.catch(() => {});
    if (!await this.flushDraft() && this.draftDirty) await this.flushDraft();
    this.allQuestions = [];
    this.questions = [];
    this.resetSession();
  }

  // ========================================
  // スクロール位置管理
  // ========================================

  private resetScroll(): void {
    this.contentEl.scrollTop = 0;
  }

  // DOMの描画後にもスクロール位置を調整する
  private resetScrollAfterRender(): void {
    this.resetScroll();

    window.requestAnimationFrame(() => {
      this.resetScroll();
    });
  }

  // ========================================
  // 問題読み込み
  // ========================================

  private async loadQuestions(): Promise<void> {
    this.contentEl.empty();
    this.resetScroll();

    this.contentEl.createEl("p", {
      text: "問題を読み込んでいます...",
    });

    try {
      const questions = await this.questionService.getQuestions();
      if (this.closing) return;

      this.allQuestions = questions;
      this.questions = [];
      this.resetSession();

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
  // 出題範囲選択
  // ========================================

  private async renderScopeSelection(): Promise<void> {
    const root = this.contentEl;

    root.empty();
    this.resetScroll();

    root.addClass("kokushi-quiz");
    root.addClass("kokushi-scope");
    root.createEl("h2", { text: "出題範囲を選択" });
    void renderDraftList(root.createDiv(), this.sessionService, id => this.resumeDraft(id));

    const loading = root.createEl("p", { text: "解答履歴を読み込んでいます..." });
    let attempts: Attempt[];

    try {
      attempts = await this.attemptService.getAttempts();
    } catch (error) {
      console.error("[Kokushi] History load error", error);
      loading.setText("解答履歴を読み込めませんでした。");
      new Notice("解答履歴の読み込みに失敗しました");
      return;
    }

    if (this.closing || this.session) return;
    loading.remove();

    // ----------------------------------------
    // 最新解答結果
    // ----------------------------------------

    const latestResults =
      new Map<string, boolean | null>();

    for (const attempt of attempts) {
      latestResults.set(
        attempt.id,
        attempt.correct
      );
    }

    // ========================================
    // 利用可能な出典
    // ========================================

    const exams = [
      ...new Set(
        this.allQuestions
          .map(
            question =>
              question.id.match(QUESTION_ID_PATTERN)?.[1]
          )
          .filter(
            (value): value is string => !!value
          )
      ),
    ].sort(
      (a, b) => Number(b) - Number(a)
    );

    if (this.quizScope.exams !== null) {
      this.quizScope.exams =
        this.quizScope.exams.filter(
          exam => exams.includes(exam)
        );
    }

    // ========================================
    // 出題対象の絞り込み
    // ========================================

    const getFilteredQuestions = (): Question[] => {
      return this.allQuestions.filter(question => {
        const exam = question.id.match(QUESTION_ID_PATTERN)?.[1];

        if (
          !exam ||
          (this.quizScope.exams !== null && !this.quizScope.exams.includes(exam))
        ) {
          return false;
        }

        // 未回答のみ
        if (
          this.quizScope.target === "unanswered"
        ) {
          return !latestResults.has(
            question.id
          );
        }

        // 最新解答が誤答
        if (
          this.quizScope.target === "incorrect"
        ) {
          return (
            latestResults.get(
              question.id
            ) === false
          );
        }

        return true;
      });
    };

    // ========================================
    // 指定問題数
    // ========================================

    const getRequestedCount = (
      available: number
    ): number | null => {
      if (this.quizScope.countMode === "all") {
        return available;
      }

      if (this.quizScope.countMode === "ten") {
        return 10;
      }

      const value =
        this.quizScope.customCount.trim();

      if (!/^[1-9]\d*$/.test(value)) {
        return null;
      }

      const count = Number(value);

      return Number.isSafeInteger(count)
        ? count
        : null;
    };

    // ========================================
    // UI共通処理
    // ========================================

    const createGroup = (
      title: string
    ): HTMLElement => {
      const group = root.createDiv({
        cls: "kokushi-scope-group",
      });

      group.createEl("h3", {
        text: title,
      });

      return group;
    };

    // ----------------------------------------
    // 問題数プレビュー
    // ----------------------------------------

    const preview = root.createDiv({
      cls: "kokushi-scope-preview",
    });

    const countEl = preview.createEl("p");

    const errorEl = preview.createEl("p", {
      cls: "kokushi-count-error",
    });

    const startButton =
      root.createEl("button", {
        text: "演習開始",
        cls: "mod-cta kokushi-start-button",
      });

    startButton.type = "button";

    let customRow: HTMLElement | null = null;

    const updateCount = (): void => {
      const available =
        getFilteredQuestions().length;

      const requested =
        getRequestedCount(available);

      if (customRow) {
        customRow.style.display =
          this.quizScope.countMode === "custom"
            ? "flex"
            : "none";
      }

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
        `条件一致：${available}問 / 出題：${actual}問`
      );

      if (
        requested > available &&
        available > 0
      ) {
        errorEl.setText(
          "指定問題数に満たないため、対象全問を出題します。"
        );
      }

      startButton.disabled = actual === 0;
    };

    // ----------------------------------------
    // 単一選択ボタングループ
    // ----------------------------------------

    const createButtons = (
      parent: HTMLElement,
      options: Array<{
        value: string;
        label: string;
      }>,
      getValue: () => string,
      setValue: (value: string) => void
    ): void => {
      const row = parent.createDiv({
        cls: "kokushi-scope-buttons",
      });

      const buttons: Array<{
        value: string;
        button: HTMLButtonElement;
      }> = [];

      const sync = (): void => {
        for (const { value, button } of buttons) {
          const active = getValue() === value;

          button.classList.toggle(
            "is-selected",
            active
          );

          button.setAttribute(
            "aria-pressed",
            String(active)
          );
        }
      };

      for (const option of options) {
        const button = row.createEl(
          "button",
          {
            text: option.label,
            cls: "kokushi-scope-button",
          }
        );

        button.type = "button";

        buttons.push({
          value: option.value,
          button,
        });

        button.addEventListener("click", () => {
          setValue(option.value);
          sync();
          updateCount();
        });
      }

      sync();
    };

    // ========================================
    // 出典の複数選択
    // ========================================

    const examGroup = createGroup("出典");

    const examActions = examGroup.createDiv({
      cls: "kokushi-scope-actions",
    });

    const allButton =
      examActions.createEl("button", {
        text: "すべて選択",
      });

    const clearButton =
      examActions.createEl("button", {
        text: "選択解除",
      });

    allButton.type = "button";
    clearButton.type = "button";

    const examRow = examGroup.createDiv({
      cls: "kokushi-scope-buttons",
    });

    const examButtons =
      new Map<string, HTMLButtonElement>();

    const syncExams = (): void => {
      for (const [exam, button] of examButtons) {
        const active =
          this.quizScope.exams === null ||
          this.quizScope.exams.includes(exam);

        button.classList.toggle(
          "is-selected",
          active
        );

        button.setAttribute(
          "aria-pressed",
          String(active)
        );
      }
    };

    for (const exam of exams) {
      const button = examRow.createEl(
        "button",
        {
          text: `第${exam}回`,
          cls: "kokushi-scope-button",
        }
      );

      button.type = "button";

      examButtons.set(exam, button);

      button.addEventListener("click", () => {
        const selected =
          this.quizScope.exams === null
            ? [...exams]
            : [...this.quizScope.exams];

        const index = selected.indexOf(exam);

        if (index >= 0) {
          selected.splice(index, 1);
        } else {
          selected.push(exam);
        }

        this.quizScope.exams =
          selected.length === exams.length
            ? null
            : selected;

        syncExams();
        updateCount();
      });
    }

    allButton.onclick = () => {
      this.quizScope.exams = null;
      syncExams();
      updateCount();
    };

    clearButton.onclick = () => {
      this.quizScope.exams = [];
      syncExams();
      updateCount();
    };

    syncExams();

    // ========================================
    // 出題順序
    // ========================================

    createButtons(
      createGroup("出題順序"),
      [
        {
          value: "sequential",
          label: "問題番号順",
        },
        {
          value: "random",
          label: "ランダム",
        },
      ],
      () => this.quizScope.order,
      value => {
        this.quizScope.order =
          value === "random"
            ? "random"
            : "sequential";
      }
    );

    // ========================================
    // 出題対象
    // ========================================

    createButtons(
      createGroup("出題対象"),
      [
        {
          value: "all",
          label: "全問題",
        },
        {
          value: "unanswered",
          label: "未回答のみ",
        },
        {
          value: "incorrect",
          label: "誤答のみ",
        },
      ],
      () => this.quizScope.target,
      value => {
        if (
          value === "all" ||
          value === "unanswered" ||
          value === "incorrect"
        ) {
          this.quizScope.target = value;
        }
      }
    );

    // ========================================
    // 出題問題数
    // ========================================

    const countGroup =
      createGroup("出題問題数");

    createButtons(
      countGroup,
      [
        {
          value: "all",
          label: "すべて",
        },
        {
          value: "ten",
          label: "10問",
        },
        {
          value: "custom",
          label: "任意",
        },
      ],
      () => this.quizScope.countMode,
      value => {
        if (
          value === "all" ||
          value === "ten" ||
          value === "custom"
        ) {
          this.quizScope.countMode = value;
        }
      }
    );

    customRow = countGroup.createDiv({
      cls: "kokushi-custom-count",
    });

    const customInput =
      customRow.createEl("input", {
        type: "number",
        placeholder: "例：25",
      });

    customInput.min = "1";
    customInput.step = "1";
    customInput.inputMode = "numeric";

    customInput.value =
      this.quizScope.customCount;

    customRow.createSpan().setText("問");

    customInput.addEventListener("input", () => {
      this.quizScope.customCount =
        customInput.value;

      updateCount();
    });

    // プレビューと開始ボタンを末尾へ
    root.appendChild(preview);
    root.appendChild(startButton);

    // ========================================
    // 演習開始
    // ========================================

    startButton.addEventListener("click", () => {
      if (this.saving || this.closing) return;
      const filtered =
        getFilteredQuestions();

      const requested =
        getRequestedCount(filtered.length);

      if (
        requested === null ||
        filtered.length === 0
      ) {
        return;
      }

      // 全候補をシャッフルしてから抽出
      if (this.quizScope.order === "random") {
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

      const actual = Math.min(
        requested,
        filtered.length
      );

      this.questions =
        filtered.slice(0, actual);

      this.startSession();

      void this.renderQuiz(true);
    });

    updateCount();
    this.resetScrollAfterRender();
  }

  // ========================================
  // 解答・セッション状態管理
  // ========================================

  private resetAnswer(): void {
    this.selected = [];
    this.unknown = false;
    this.graded = null;
    this.saving = false;
  }

  private resetSession(): void {
    this.cancelDraftTimer();
    if (this.session) this.sessionService.releaseDraft(this.session.id);
    this.session = null;
    this.sessionCompleted = false;
    this.draftDirty = false;
    this.draftWrite = Promise.resolve(true);
    this.draftErrorShown = false;
    this.questionStates.clear();
    this.index = 0;
    this.resetAnswer();
  }

  private startSession(sourceSessionId?: string): void {
    this.resetSession();
    if (this.questions.length === 0) return;

    const { exams, order, target } = this.quizScope;
    const startedAt = new Date().toISOString();
    const suffix = Array.from(crypto.getRandomValues(new Uint32Array(2)))
      .map(value => value.toString(16).padStart(8, "0"))
      .join("");

    this.session = {
      id: `${startedAt.replace(/:/g, "-")}_${suffix}`,
      startedAt,
      scope: { exams: exams === null ? null : [...exams], order, target },
      sourceSessionId,
    };
    this.sessionService.claimDraft(this.session.id);
    this.draftDirty = true;
    void this.flushDraft();
  }

  private createSessionRecord(
    session: NonNullable<QuizView["session"]>,
    status: "in-progress" | "completed"
  ): SessionRecord {
    return {
      ...session,
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      status,
      currentIndex: status === "in-progress" ? this.index : undefined,
      result: this.getSessionResult(),
      questions: this.questions.map((question, index) => {
        const state = this.questionStates.get(index);
        return {
          id: question.id,
          selected: state?.selected ?? [],
          grade: state?.graded ?? null,
          unknown: state?.unknown ?? false,
        };
      }),
    };
  }

  private cancelDraftTimer(): void {
    if (this.draftTimer === null) return;
    window.clearTimeout(this.draftTimer);
    this.draftTimer = null;
  }

  private scheduleDraftSave(immediate = false): void {
    if (!this.session || this.sessionCompleted) return;
    this.draftDirty = true;

    if (immediate) {
      void this.flushDraft();
      return;
    }

    this.cancelDraftTimer();
    this.draftTimer = window.setTimeout(() => { void this.flushDraft(); }, 350);
  }

  private flushDraft(): Promise<boolean> {
    this.cancelDraftTimer();
    const session = this.session;
    if (!session || this.sessionCompleted) return Promise.resolve(true);
    if (!this.draftDirty) return this.draftWrite;

    this.saveCurrentState();
    this.draftDirty = false;
    this.draftWrite = this.sessionService.save(this.createSessionRecord(session, "in-progress")).then(
      () => {
        if (this.session === session) this.draftErrorShown = false;
        return true;
      },
      error => {
        console.error("[Kokushi] Draft save error", error);
        if (this.session === session && !this.sessionCompleted) {
          this.draftDirty = true;
          if (!this.draftErrorShown) {
            this.draftErrorShown = true;
            new Notice("中断データを保存できませんでした。");
          }
        }
        return false;
      },
    );
    return this.draftWrite;
  }

  private async leaveSession(): Promise<boolean> {
    if (this.saving || this.closing) return false;
    this.saving = true;
    try {
      return await this.flushDraft() && !this.closing;
    } finally {
      this.saving = false;
    }
  }

  public async resumeDraft(id: string): Promise<void> {
    if (this.session?.id === id || !await this.leaveSession()) return;

    if (!this.sessionService.claimDraft(id)) {
      new Notice("この演習は別のペインで開いています。");
      return;
    }

    this.saving = true;
    let adopted = false;
    try {
      const record = await this.sessionService.getSession(id);
      if (this.closing) return;
      if (record?.status !== "in-progress" || record.currentIndex === undefined) {
        new Notice("再開できる演習が見つかりませんでした。");
        return;
      }

      const allQuestions = await this.questionService.getQuestions();
      if (this.closing) return;

      const available = new Map(allQuestions.map(question => [question.id, question]));
      const questions: Question[] = [];
      for (const item of record.questions) {
        const question = available.get(item.id);
        if (!question) {
          new Notice(`問題 ${item.id} が見つからないため、演習を再開できません。`);
          return;
        }
        questions.push(question);
      }

      this.resetSession();
      const { startedAt, scope, sourceSessionId } = record;
      this.session = { id, startedAt, scope, sourceSessionId };
      adopted = true;
      this.quizScope = { ...this.quizScope, ...scope };
      this.allQuestions = allQuestions;
      this.questions = questions;
      record.questions.forEach((item, index) => {
        this.questionStates.set(index, {
          selected: [...item.selected],
          unknown: item.unknown,
          graded: item.grade,
        });
      });
      this.index = record.currentIndex;
      this.restoreState(this.index);
      await this.renderQuiz(true);
    } catch (error) {
      console.error("[Kokushi] Draft resume error", error);
      new Notice("中断した演習を読み込めませんでした。");
    } finally {
      if (!adopted) this.sessionService.releaseDraft(id);
      this.saving = false;
    }
  }

  private saveCurrentState(): void {
    if (
      this.index < 0 ||
      this.index >= this.questions.length
    ) {
      return;
    }

    this.questionStates.set(
      this.index,
      {
        selected: [...this.selected],
        graded: this.graded,
        unknown: this.unknown,
      }
    );
  }

  private restoreState(index: number): void {
    const state = this.questionStates.get(index);

    if (!state) {
      this.resetAnswer();
      return;
    }

    this.selected = [...state.selected];
    this.graded = state.graded;
    this.unknown = state.unknown;
    this.saving = false;
  }

  // ========================================
  // 問題間移動
  // 未採点でも移動できる
  // ========================================

  private async moveToQuestion(
    newIndex: number
  ): Promise<void> {
    if (this.saving) return;

    if (
      newIndex < 0 ||
      newIndex >= this.questions.length
    ) {
      return;
    }

    // 未採点の解答を保持してから問題を移動する。
    this.saveCurrentState();

    this.index = newIndex;

    this.restoreState(newIndex);
    this.scheduleDraftSave(true);

    // 問題遷移時は最上部へ戻す
    await this.renderQuiz(true);
  }

  // ========================================
  // 結果画面へ移動
  // ========================================

  private async openSessionResults(): Promise<void> {
    const session = this.session;
    if (this.saving || this.closing || !session) return;

    this.saveCurrentState();
    this.cancelDraftTimer();
    this.saving = true;

    try {
      const write = this.sessionService.save(this.createSessionRecord(session, "completed"));
      this.pendingOperation = write;
      await write;
      if (this.session !== session) return;
      this.sessionCompleted = true;
      this.sessionService.releaseDraft(session.id);
    } catch (error) {
      console.error("[Kokushi] Session save error", error);
      if (this.draftDirty && !this.closing) this.scheduleDraftSave();
      new Notice("演習履歴を保存できませんでした。もう一度お試しください。");
      return;
    } finally {
      this.pendingOperation = null;
      if (this.session === session) this.saving = false;
    }

    if (this.closing || this.session !== session) return;
    this.index = this.questions.length;
    this.resetAnswer();
    await this.renderQuiz(true);
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

    return question.answer[0]?.length ?? 0;
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

    // 「わからない」は採点可能
    if (this.unknown) {
      return true;
    }

    // 数値解答
    if (question.type === "numeric") {
      return (
        this.selected.length === 1 &&
        /^\d+$/.test(
          this.selected[0] ?? ""
        )
      );
    }

    // 採点除外問題
    if (
      question.excluded &&
      question.answer.length === 0
    ) {
      return this.selected.length > 0;
    }

    const required =
      this.getRequiredChoices(question);

    return (
      required > 0 &&
      this.selected.length === required &&
      new Set(this.selected).size === required
    );
  }

  // ========================================
  // Markdownセクション取得
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
      const line = lines[i] ?? "";

      if (/^#{1,2}\s+/.test(line)) {
        break;
      }

      result.push(line);
    }

    return result.join("\n").trim();
  }

  // ========================================
  // 選択肢解析
  // ========================================

  private parseOptions(
    markdown: string
  ): Option[] {
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
  // 問題画面
  //
  // resetScroll:
  // true  = 画面遷移時に最上部へ
  // false = 再描画後も現在位置を維持
  // ========================================

  private async renderQuiz(
    resetScroll = true
  ): Promise<void> {
    const container = this.contentEl;

    // スクロール位置を保持する再描画に備える
    const previousScroll = container.scrollTop;

    container.empty();

    if (resetScroll) {
      this.resetScroll();
    }

    container.removeClass("kokushi-scope");
    container.addClass("kokushi-quiz");

    const question = this.getCurrentQuestion();

    if (!question) {
      this.renderFinished(container);

      if (resetScroll) {
        this.resetScrollAfterRender();
      } else {
        container.scrollTop = previousScroll;
      }

      return;
    }

    // ========================================
    // ヘッダー
    // ========================================

    const header = container.createDiv({
      cls: "kokushi-header",
    });

    const progress = header.createEl("p", { cls: "kokushi-question-progress" });
    progress.createEl("strong", { text: question.id });
    progress.createSpan({ text: ` (${this.index + 1} / ${this.questions.length})` });

    const backButton = header.createEl("button", {
      text: "戻る",
      attr: { "aria-label": "出題範囲に戻る" },
    });
    backButton.type = "button";

    backButton.disabled = this.saving;

    backButton.onclick = async () => {
      if (!await this.leaveSession()) return;

      this.questions = [];
      this.resetSession();
      await this.renderScopeSelection();
    };

    // ========================================
    // 問題文
    // ========================================

    const questionMarkdown =
      this.getSection(
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

      questionEl.querySelectorAll("table").forEach(table => {
        const parent = table.parentElement;
        const wrapper = parent?.classList.contains("table-wrapper") ? parent : questionEl.createDiv();
        wrapper.addClass("kokushi-question-table");
        wrapper.tabIndex = 0;
        wrapper.setAttribute("role", "region");
        wrapper.setAttribute("aria-label", "問題文の表");
        if (wrapper !== parent) {
          table.before(wrapper);
          wrapper.appendChild(table);
        }
      });
    } else {
      questionEl.createEl("p", {
        text: "問題文が見つかりません。",
      });
    }

    // ========================================
    // 解答エリア
    // ========================================

    const answerEl = container.createDiv({
      cls: "kokushi-answer",
    });

    let submitButton: HTMLButtonElement | null = null;

    const updateSubmit = (): void => {
      if (submitButton) {
        submitButton.disabled =
          !this.canSubmit(question);
      }
    };

    if (question.type === "numeric") {
      this.renderNumericInput(
        answerEl,
        updateSubmit
      );
    } else {
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

    // ========================================
    // 「わからない」ボタン
    // ========================================

    const unknownButton =
      container.createEl("button", {
        text: this.unknown
          ? "わからない ✓"
          : "わからない",
        cls: "kokushi-unknown-button",
      });

    unknownButton.type = "button";

    unknownButton.classList.toggle(
      "is-selected",
      this.unknown
    );

    unknownButton.setAttribute(
      "aria-pressed",
      String(this.unknown)
    );

    unknownButton.disabled =
      this.graded !== null || this.saving;

    unknownButton.onclick = () => {
      if (
        this.graded !== null ||
        this.saving
      ) {
        return;
      }

      this.unknown = !this.unknown;

      if (this.unknown) {
        this.selected = [];
      }

      this.scheduleDraftSave();

      // ボタン操作は画面遷移ではない
      // スクロール位置を維持する
      void this.renderQuiz(false);
    };

    // ========================================
    // 解答・採点ボタン
    // ========================================

    if (this.graded === null) {
      submitButton = container.createEl(
        "button",
        {
          text: "解答・採点",
          cls: "mod-cta kokushi-wide-action kokushi-submit",
        }
      );

      submitButton.type = "button";

      updateSubmit();

      submitButton.onclick = async () => {
        if (!this.canSubmit(question)) {
          return;
        }

        if (submitButton) {
          submitButton.disabled = true;
        }

        await this.submitAnswer(question);
      };
    } else {
      this.renderResult(
        container,
        question
      );
    }

    // ========================================
    // 前後移動・結果画面ボタン
    // ========================================

    this.renderNavigation(container);

    // ========================================
    // 描画完了後のスクロール位置調整
    // ========================================

    if (resetScroll) {
      this.resetScrollAfterRender();
    } else {
      // 「わからない」切替・採点などの再描画
      // ではユーザーの閲覧位置を維持
      container.scrollTop = previousScroll;

      window.requestAnimationFrame(() => {
        container.scrollTop = previousScroll;
      });
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

    const required =
      this.getRequiredChoices(question);

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

    for (const option of options) {
      const label = container.createEl(
        "label",
        {
          cls: "kokushi-option",
        }
      );

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

      input.disabled =
        this.graded !== null ||
        this.unknown ||
        this.saving;

      inputs.push(input);

      const textEl = label.createDiv({
        cls: "kokushi-option-text",
      });

      textEl.createSpan({ text: `${option.id}.`, cls: "kokushi-option-letter" });
      const markdownEl = textEl.createDiv({ cls: "kokushi-option-markdown" });

      await MarkdownRenderer.render(
        this.app,
        option.markdown,
        markdownEl,
        question.path,
        this
      );

      input.addEventListener("change", () => {
        if (
          this.graded !== null ||
          this.saving ||
          this.unknown
        ) {
          return;
        }

        // 単一選択
        if (question.type === "single") {
          this.selected = [option.id];
        } else {
          // 複数選択
          if (input.checked) {
            if (
              required > 0 &&
              this.selected.length >= required
            ) {
              input.checked = false;
              return;
            }

            if (
              !this.selected.includes(option.id)
            ) {
              this.selected.push(option.id);
            }
          } else {
            this.selected =
              this.selected.filter(
                id => id !== option.id
              );
          }
        }

        // UI同期
        for (const item of inputs) {
          item.checked =
            this.selected.includes(item.value);
        }

        updateSubmit();
        this.scheduleDraftSave();
      });
    }
  }

  // ========================================
  // 数値解答
  // ========================================

  private renderNumericInput(
    container: HTMLElement,
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

    input.disabled =
      this.graded !== null ||
      this.unknown ||
      this.saving;

    input.addEventListener("input", () => {
      if (
        this.graded !== null ||
        this.saving ||
        this.unknown
      ) {
        return;
      }

      const value = input.value.trim();

      this.selected =
        /^\d+$/.test(value)
          ? [value]
          : [];

      updateSubmit();
      this.scheduleDraftSave();
    });
  }

  // ========================================
  // 採点・JSONL保存
  // ========================================

  private async submitAnswer(
    question: Question
  ): Promise<void> {
    if (!this.canSubmit(question)) {
      return;
    }

    this.saving = true;

    const session = this.session;
    const selected = [...this.selected];
    const wasUnknown = this.unknown;

    const result: GradeResult =
      question.excluded
        ? "excluded"
        : wasUnknown
          ? "incorrect"
          : GradingService.grade(
              question,
              selected
            );

    try {
      const write = this.attemptService.save({
        id: question.id,
        timestamp: new Date().toISOString(),
        selected,
        correct:
          result === "excluded"
            ? null
            : result === "correct",
      });
      this.pendingOperation = write;
      await write;
      this.pendingOperation = null;

      if (this.session !== session) return;
      this.graded = result;
      this.saving = false;

      this.saveCurrentState();
      this.scheduleDraftSave(true);
      if (this.closing) return;

      // 採点後は現在のスクロール位置を維持
      await this.renderQuiz(false);
    } catch (error) {
      this.pendingOperation = null;
      console.error(
        "[Kokushi] Attempt save error",
        error
      );

      if (this.session !== session) return;
      this.saving = false;

      new Notice(
        "解答履歴を保存できませんでした。"
      );

      if (!this.closing) await this.renderQuiz(false);
    }
  }

  // ========================================
  // 採点結果
  // ========================================

  private renderResult(
    container: HTMLElement,
    question: Question
  ): void {
    if (this.graded === null) return;

    const resultEl = container.createDiv({
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
      cls: `kokushi-result-grade is-${this.graded}`,
    });

    if (this.unknown) {
      resultEl.createEl("p", {
        text: "「わからない」で解答しました。",
      });
    }

    resultEl.createEl("p", {
      text: question.excluded
        ? "この問題は採点対象外です。"
        : `正答：${this.formatCorrectAnswer(question)}`,
    });

    const studyPanel = resultEl.createDiv({ cls: "kokushi-question-study" });
    void renderQuestionStudy(studyPanel, this.app, question, this.studyService);
  }

  // ========================================
  // 問題間ナビゲーション
  // ========================================

  private renderNavigation(container: HTMLElement): void {
    const nav = container.createDiv({
      cls: "kokushi-navigation",
    });

    // ----------------------------------------
    // 前の問題
    // ----------------------------------------

    const previousButton = nav.createEl(
      "button",
      {
        text: "← 前の問題",
      }
    );

    previousButton.disabled =
      this.index === 0 || this.saving;

    previousButton.onclick = () => {
      void this.moveToQuestion(
        this.index - 1
      );
    };

    // ----------------------------------------
    // 次の問題・演習終了
    // ----------------------------------------

    const isLast =
      this.index + 1 >= this.questions.length;

    const nextButton = nav.createEl(
      "button",
      {
        text: isLast
          ? "演習終了"
          : "次の問題 →",

        // 採点済みだけ紫色
        cls: this.graded !== null
          ? "mod-cta"
          : "",
      }
    );

    // 未採点でも移動可能
    nextButton.disabled = this.saving;

    nextButton.onclick = () => {
      if (isLast) {
        void this.openSessionResults();
        return;
      }

      void this.moveToQuestion(this.index + 1);
    };

    // ----------------------------------------
    // 演習結果を確認
    // ----------------------------------------

    const resultButton =
      container.createEl("button", {
        text: "演習結果を見る",
        cls: "kokushi-wide-action kokushi-view-results",
      });

    resultButton.disabled = this.saving;

    resultButton.onclick = () => {
      void this.openSessionResults();
    };
  }

  // ========================================
  // セッション結果集計
  // ========================================

  private getSessionResult(): SessionResult {
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    let excluded = 0;

    for (
      let i = 0;
      i < this.questions.length;
      i++
    ) {
      const state =
        this.questionStates.get(i);

      const graded = state?.graded ?? null;

      switch (graded) {
        case "correct":
          correct++;
          break;

        case "incorrect":
          incorrect++;
          break;

        case "excluded":
          excluded++;
          break;

        default:
          unanswered++;
          break;
      }
    }

    const gradedCount =
      correct + incorrect;

    return {
      correct,
      incorrect,
      unanswered,
      excluded,
      accuracy:
        gradedCount > 0
          ? correct / gradedCount * 100
          : null,
    };
  }

  // ========================================
  // 正答表示
  // ========================================

  private formatCorrectAnswer(
    question: Question
  ): string {
    if (question.excluded) {
      return "採点除外";
    }

    if (question.answer.length === 0) {
      return "—";
    }

    return question.answer
      .map(set =>
        question.type === "numeric"
          ? set.join("")
          : set.join(", ")
      )
      .join(" または ");
  }

  // ========================================
  // 自分の解答表示
  // ========================================

  private formatSelectedAnswer(
    state: QuestionState | undefined
  ): string {
    if (!state) {
      return "—";
    }

    if (state.unknown) {
      return state.graded === null
        ? "わからない（未確定）"
        : "わからない";
    }

    return state.selected.length > 0
      ? state.selected.join(", ")
      : "—";
  }

  // ========================================
  // 正誤表示
  // ========================================

  private formatSessionStatus(
    state: QuestionState | undefined
  ): string {
    switch (state?.graded) {
      case "correct":
        return "正解";

      case "incorrect":
        return "不正解";

      case "excluded":
        return "採点除外";

      default:
        return "未採点";
    }
  }

  // ========================================
  // 演習結果画面
  // ========================================

  private renderFinished(
    container: HTMLElement
  ): void {
    container.empty();

    container.createEl("h2", {
      text: "演習結果",
    });

    const total = this.questions.length;

    // ----------------------------------------
    // 問題がない場合
    // ----------------------------------------

    if (total === 0) {
      container.createEl("p", {
        text: "演習した問題がありません。",
      });

      const backButton =
        container.createEl("button", {
          text: "出題範囲に戻る",
        });

      backButton.onclick = () => {
        void this.renderScopeSelection();
      };

      return;
    }

    // ========================================
    // セッション集計
    // ========================================

    const result = this.getSessionResult();

    container.createEl("p", {
      text: `出題問題数：${total}問`,
    });

    const summary = container.createDiv({
      cls: "kokushi-session-summary",
    });

    const addSummaryCard = (
      label: string,
      value: string,
      status: string
    ): void => {
      const card = summary.createDiv({
        cls: `kokushi-session-card ${status}`,
      });

      card.createEl("p", {
        cls: "kokushi-session-card-label",
        text: label,
      });

      card.createEl("p", {
        cls: "kokushi-session-card-value",
        text: value,
      });
    };

    addSummaryCard(
      "正解",
      `${result.correct}問`,
      "is-correct"
    );

    addSummaryCard(
      "不正解",
      `${result.incorrect}問`,
      "is-incorrect"
    );

    addSummaryCard(
      "未採点",
      `${result.unanswered}問`,
      "is-unanswered"
    );

    addSummaryCard(
      "採点除外",
      `${result.excluded}問`,
      "is-excluded"
    );

    // ========================================
    // セッション正答率
    // ========================================

    const rate = container.createDiv({
      cls: "kokushi-session-accuracy",
    });

    rate.createEl("h3", {
      text: "今回の正答率",
    });

    rate.createEl("p", {
      text:
        result.accuracy === null
          ? "—"
          : `${result.accuracy.toFixed(1)}%`,
    });

    rate.createEl("p", {
      cls: "kokushi-session-note",
      text:
        `正解 ${result.correct}問 / ` +
        `採点対象 ${
          result.correct + result.incorrect
        }問` +
        "（未採点・採点除外は含まない）",
    });

    // ========================================
    // 問題一覧
    // ========================================

    container.createEl("h3", {
      text: "演習した問題の一覧",
    });

    const tableWrapper =
      container.createDiv({
        cls: "kokushi-session-table-wrapper",
      });

    const table = tableWrapper.createEl(
      "table",
      {
        cls: "kokushi-session-table",
      }
    );

    const thead = table.createEl("thead");

    const headerRow =
      thead.createEl("tr");

    for (const title of [
      "問題番号",
      "正答",
      "自分の解答",
      "正誤",
    ]) {
      headerRow.createEl("th", {
        text: title,
      });
    }

    const tbody = table.createEl("tbody");

    for (
      let i = 0;
      i < this.questions.length;
      i++
    ) {
      const question = this.questions[i];

      if (!question) continue;

      const state =
        this.questionStates.get(i);

      const status =
        this.formatSessionStatus(state);

      const row = tbody.createEl("tr");

      // ------------------------------------
      // 問題番号リンク
      // ------------------------------------

      const idCell = row.createEl("td");

      const linkButton =
        idCell.createEl("button", {
          text: question.id,
          cls: "kokushi-session-question-link",
        });

      linkButton.type = "button";

      linkButton.onclick = () => {
        void this.moveToQuestion(i);
      };

      // ------------------------------------
      // 正答
      // ------------------------------------

      row.createEl("td", {
        text: this.formatCorrectAnswer(
          question
        ),
      });

      // ------------------------------------
      // 自分の解答
      // ------------------------------------

      row.createEl("td", {
        text: this.formatSelectedAnswer(
          state
        ),
      });

      // ------------------------------------
      // 正誤
      // ------------------------------------

      const statusCell =
        row.createEl("td");

      const statusEl =
        statusCell.createSpan();

      statusEl.addClass(
        "kokushi-session-status"
      );

      statusEl.setText(status);

      const statusClass =
        status === "正解"
          ? "is-correct"
          : status === "不正解"
            ? "is-incorrect"
            : status === "採点除外"
              ? "is-excluded"
              : "is-unanswered";

      statusEl.addClass(statusClass);
    }

    // ========================================
    // 結果画面の操作ボタン
    // ========================================

    const actions = container.createDiv({
      cls: "kokushi-session-actions",
    });

    // ----------------------------------------
    // 最後の問題に戻る
    // ----------------------------------------

    const previousButton =
      actions.createEl("button", {
        text: "← 最後の問題に戻る",
      });

    previousButton.onclick = () => {
      void this.moveToQuestion(
        total - 1
      );
    };

    // ----------------------------------------
    // 同じ問題セットで再演習
    // ----------------------------------------

    const restartButton =
      actions.createEl("button", {
        text: "同じ問題でもう一度",
      });

    restartButton.onclick = () => {
      this.startSession();

      void this.renderQuiz(true);
    };

    // ----------------------------------------
    // 出題範囲を選び直す
    // ----------------------------------------

    const scopeButton =
      actions.createEl("button", {
        text: "出題範囲を選び直す",
        cls: "mod-cta",
      });

    scopeButton.onclick = () => {
      this.questions = [];
      this.resetSession();
      void this.renderScopeSelection();
    };
  }

  // ========================================
  // ダッシュボードから演習開始
  // ========================================

  public async startFromDashboard(
    target: "unanswered" | "incorrect"
  ): Promise<void> {
    if (!await this.leaveSession()) return;
    await this.loadQuestions();
    if (this.closing) return;

    const attempts =
      await this.attemptService.getAttempts();
    if (this.closing) return;

    const latestResults =
      new Map<string, boolean | null>();

    for (const attempt of attempts) {
      latestResults.set(
        attempt.id,
        attempt.correct
      );
    }

    this.quizScope = {
      exams: null,
      order: "sequential",
      target,
      countMode: "all",
      customCount: "25",
    };

    this.questions =
      this.allQuestions.filter(question => {
        if (target === "unanswered") {
          return !latestResults.has(
            question.id
          );
        }

        return (
          latestResults.get(
            question.id
          ) === false
        );
      });

    this.startSession();

    await this.renderQuiz(true);
  }

  // ========================================
  // ダッシュボードから個別問題を開く
  // ========================================

  public async openQuestionFromDashboard(
    id: string
  ): Promise<void> {
    if (!await this.leaveSession()) return;
    await this.loadQuestions();
    if (this.closing) return;

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

    this.quizScope = {
      exams: null,
      order: "sequential",
      target: "all",
      countMode: "all",
      customCount: "25",
    };

    this.questions = [question];

    this.startSession();

    await this.renderQuiz(true);
  }

  public async startFromHistory(record: SessionRecord): Promise<boolean> {
    if (!await this.leaveSession()) return false;

    this.saving = true;
    try {
      const allQuestions = await this.questionService.getQuestions();
      if (this.closing) return false;

      const byId = new Map(allQuestions.map(question => [question.id, question]));
      const incorrect = record.questions.filter(question => question.grade === "incorrect");
      const questions = incorrect.flatMap(item => {
        const question = byId.get(item.id);
        return question ? [question] : [];
      });

      if (questions.length === 0) {
        new Notice("再演習できる誤答問題がありません。");
        return false;
      }

      if (questions.length < incorrect.length) {
        new Notice(`${incorrect.length - questions.length}問が見つからないため、読み込めた問題で再演習します。`);
      }

      this.allQuestions = allQuestions;
      this.questions = questions;
      this.quizScope = {
        exams: null,
        order: "sequential",
        target: "incorrect",
        countMode: "all",
        customCount: "25",
      };
      this.startSession(record.id);
      await this.renderQuiz(true);
      return true;
    } catch (error) {
      console.error("[Kokushi] History retry error", error);
      new Notice("誤答問題を読み込めませんでした。");
      return false;
    } finally {
      this.saving = false;
    }
  }
}
