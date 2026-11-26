import type { KokushiAI } from "../ai/KokushiAI";
import { matchesSubjects, UNCLASSIFIED } from "../ai/subjects";
import { SubjectSelectionModal, subjectLabel } from "./SubjectSelectionModal";
import { locale, t } from "../i18n";
import { bindAppearance, getPresetCount, unbindAppearance } from "./KokushiAppearance";

import {
  ItemView,
  MarkdownRenderer,
  Notice,
  Platform,
  WorkspaceLeaf,
} from "obsidian";

import {
  Question,
  GradeResult,
  SessionResult,
  SessionRecord,
  HistoryRetryMode,
  PracticeTarget,
} from "../types";

import { fitQuestionUnits, questionUnits } from "../services/QuestionSequences";
import { QuestionService } from "../services/QuestionService";
import { QuestionStudyService } from "../services/QuestionStudyService";
import {
  ALL_PRACTICE_TARGETS, DEFAULT_PRACTICE_TARGETS, ratingLabel, attemptGrade, attemptRating, defaultRating, latestAttemptRatings,
} from "../services/PracticeTargets";
import { GradingService } from "../services/GradingService";
import { AttemptService } from "../services/AttemptService";
import { SessionService, sessionAccuracy } from "../services/SessionService";
import { questionKey } from "../services/QuestionIdentity";
import { bindImagePreview } from "./ImagePreviewModal";
import { openQuestionEditor } from "./QuestionEditor";
import { SourceSelectionModal } from "./SourceSelectionModal";
import { gradeLabel } from "./sessionFormatting";
import { renderDraftList } from "./DraftList";
import { DiscardSessionModal } from "./DiscardSessionModal";
import { renderQuestionStudy } from "./QuestionStudyPanel";
import { arrangeQuestionImages, copyQuestionText, formatQuestionCopy } from "./questionMedia";

export const VIEW_TYPE_KOKUSHI = "kokushi-quiz";

// ========================================
// 型定義
// ========================================

type OrderMode = "sequential" | "random";

type CountMode = "all" | "preset" | "custom";

type QuizScope = {
  sources: string[] | null;
  subjects: string[] | null;
  order: OrderMode;
  targets: PracticeTarget[];
  countMode: CountMode;
  customCount: string;
};

type QuestionState = {
  selected: string[];
  graded: GradeResult | null;
  rating: PracticeTarget;
  confirmed?: boolean;
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
  private rating: PracticeTarget = "unanswered";
  private saving = false;
  private session: Pick<SessionRecord, "id" | "startedAt" | "scope" | "sourceSessionId"> | null = null;
  private sessionCompleted = false;
  private draftDirty = false;
  private draftTimer: number | null = null;
  private draftWrite = Promise.resolve(true);
  private draftErrorShown = false;
  private pendingOperation: Promise<void> | null = null;
  private closing = false;
  private memoEditor: Promise<(() => Promise<boolean>) | undefined> | null = null;
  private stopWatchingImages: (() => void) | null = null;

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
    sources: null,
    subjects: null,
    order: "sequential",
    targets: [...DEFAULT_PRACTICE_TARGETS],
    countMode: "all",
    customCount: "25",
  };

  constructor(
    leaf: WorkspaceLeaf,
    private questionService: QuestionService,
    private attemptService: AttemptService,
    private sessionService: SessionService,
    private studyService: QuestionStudyService,
    private openDashboard: () => Promise<void>,
    private ai?: KokushiAI
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
    return t("演習");
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen(): Promise<void> {
    bindAppearance(this.app, this.containerEl ?? this.contentEl);
    this.closing = false;
    await this.loadQuestions();
  }

  async onClose(): Promise<void> {
    unbindAppearance(this.app, this.containerEl ?? this.contentEl);
    this.closing = true;
    this.stopWatchingImages?.();
    this.stopWatchingImages = null;
    await this.pendingOperation?.catch(() => {});
    if (!await this.flushMemo() && !await this.flushMemo()) {
      new Notice(t("メモを保存できませんでした。"));
    }
    this.memoEditor = null;
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
      text: t("問題を読み込んでいます..."),
    });

    try {
      const questions = await this.questionService.getQuestions();
      if (this.closing) return;

      this.allQuestions = questions;
      this.quizScope.targets = [...DEFAULT_PRACTICE_TARGETS];
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
        text: t("問題の読み込みに失敗しました。"),
      });

      new Notice(
        t("問題の読み込みに失敗しました")
      );
    }
  }

  // ========================================
  // 出題範囲選択
  // ========================================

  private async renderScopeSelection(): Promise<void> {
    const root = this.contentEl;
    this.memoEditor = null;

    this.stopWatchingImages?.();
    this.stopWatchingImages = null;
    root.empty();
    this.resetScroll();

    root.addClass("kokushi-quiz");
    root.addClass("kokushi-scope");
    const heading = root.createDiv({ cls: "kokushi-section-heading" });
    heading.createEl("h2", { text: t("出題範囲を選択") });
    const refresh = heading.createEl("button", { type: "button", text: t("更新") });
    refresh.onclick = async () => {
      if (refresh.disabled) return;
      refresh.disabled = true;
      try {
        const questions = await this.questionService.getQuestions();
        if (this.closing || this.session || !root.contains(heading)) return;
        this.allQuestions = questions;
        await this.renderScopeSelection();
      } catch (error) {
        console.error("[Kokushi] Scope refresh error", error);
        new Notice(t("出題範囲を更新できませんでした。"));
      } finally {
        refresh.disabled = false;
      }
    };
    renderDraftList(root.createDiv({ cls: "kokushi-scope-group kokushi-drafts" }), this.app, this.sessionService, {
      resume: id => this.resumeDraft(id),
      retry: (record, mode) => this.startFromHistory(record, mode),
    });

    const loading = root.createEl("p", { text: t("解答履歴を読み込んでいます...") });
    let ratings: Map<string, PracticeTarget>;

    try {
      const [attempts] = await Promise.all([this.attemptService.getAttempts(), this.ai?.loadClassifications()]);
      ratings = latestAttemptRatings(attempts);
    } catch (error) {
      console.error("[Kokushi] History load error", error);
      loading.setText(t("解答履歴を読み込めませんでした。"));
      new Notice(t("解答履歴の読み込みに失敗しました"));
      return;
    }

    if (this.closing || this.session || !root.contains(heading)) return;
    loading.remove();

    // ========================================
    // 利用可能な出典
    // ========================================

    const sources = [...new Set(this.allQuestions.map(question => question.source))]
      .sort((a, b) => b.localeCompare(a, "ja", { numeric: true }));

    if (this.quizScope.sources !== null) {
      this.quizScope.sources =
        this.quizScope.sources.filter(
          source => sources.includes(source)
        );
    }

    // ========================================
    // 出題対象の絞り込み
    // ========================================

    const subjects = this.ai?.subjects ?? [];
    const validSubjects = new Set([...subjects, UNCLASSIFIED]);
    if (!subjects.length) this.quizScope.subjects = null;
    else if (this.quizScope.subjects !== null) {
      this.quizScope.subjects = this.quizScope.subjects.filter(subject => validSubjects.has(subject));
    }

    const assignments = new Map<Question, readonly string[]>();
    const matchesSubjectFilter = (question: Question): boolean => {
      if (this.quizScope.subjects === null) return true;
      let assigned = assignments.get(question);
      if (!assigned) {
        assigned = this.ai?.subjectsOf(question) ?? [];
        assignments.set(question, assigned);
      }
      return matchesSubjects(assigned, this.quizScope.subjects);
    };
    const units = questionUnits(this.allQuestions);
    const getFilteredUnits = (): Question[][] => units.filter(unit => unit.some(question =>
      (this.quizScope.sources === null || this.quizScope.sources.includes(question.source)) &&
      this.quizScope.targets.includes(ratings.get(questionKey(question)) ?? "unanswered") &&
      matchesSubjectFilter(question)
    ));

    // ========================================
    // 指定問題数
    // ========================================

    const presetCount = getPresetCount(this.app);
    const getRequestedCount = (
      available: number
    ): number | null => {
      if (this.quizScope.countMode === "all") {
        return available;
      }

      if (this.quizScope.countMode !== "custom") {
        return presetCount;
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

    const createGroup = (group: HTMLElement, title: string): { group: HTMLElement; row: HTMLElement } => {
      const heading = group.createDiv({ cls: "kokushi-scope-inline" });
      heading.createEl("h3", { text: title });
      const row = heading.createDiv({ cls: "kokushi-scope-buttons", attr: { role: "group", "aria-label": title } });
      return { group, row };
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
        text: t("演習開始"),
        cls: "mod-cta kokushi-start-button",
      });

    startButton.type = "button";

    let customRow: HTMLElement | null = null;

    const updateCount = (): void => {
      const units = getFilteredUnits();
      const available = units.reduce((count, unit) => count + unit.length, 0);

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
          t("条件一致：{0}問", available)
        );

        errorEl.setText(
          t("1以上の整数を入力してください。")
        );

        startButton.disabled = true;
        return;
      }

      const actual = this.quizScope.order === "sequential"
        ? fitQuestionUnits(units, requested).length
        : Math.min(requested, available);

      countEl.setText(
        t("条件一致：{0}問 / 出題：{1}問", available, actual)
      );

      const includesSequences = units.some(unit => unit.length > 1);
      if (includesSequences && requested < available) {
        errorEl.setText(t("残りの出題枠に収まらない連問は見送ります。"));
        if (this.quizScope.order === "random") countEl.setText(t("条件一致：{0}問 / 出題：最大{1}問", available, actual));
      } else if (requested > available && available > 0) {
        errorEl.setText(t("指定問題数に満たないため、対象全問を出題します。"));
      }

      startButton.disabled = actual === 0 || !units.some(unit => unit.length <= requested);
    };

    // ----------------------------------------
    // 単一選択ボタングループ
    // ----------------------------------------

    const createButtons = (
      row: HTMLElement,
      options: Array<{
        value: string;
        label: string;
      }>,
      getValue: () => string,
      setValue: (value: string) => void
    ): void => {
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

    const sourceGroup = root.createDiv({ cls: "kokushi-scope-group" });
    const sourceHeading = sourceGroup.createDiv({ cls: "kokushi-section-heading" });
    sourceHeading.createEl("h3", { text: t("出典") });
    const sourceActions = sourceHeading.createDiv({
      cls: "kokushi-scope-actions",
    });

    if (sources.length >= 21) {
      const summary = sourceGroup.createDiv({ cls: "kokushi-source-summary" });
      const sync = (): void => {
        const selected = this.quizScope.sources;
        summary.empty();
        if (selected === null || selected.length === sources.length) {
          summary.createEl("p", { text: t("すべての出典（{0}件）", sources.length) });
        } else if (!selected.length) {
          summary.createEl("p", { text: t("出典が選択されていません") });
        } else {
          const list = summary.createEl("ul");
          for (const source of sources) {
            if (selected.includes(source)) list.createEl("li", { text: source });
          }
        }
      };
      const choose = sourceActions.createEl("button", { type: "button", text: t("選択") });
      choose.onclick = () => new SourceSelectionModal(this.app, sources, this.quizScope.sources, selected => {
        if (!root.contains(heading) || refresh.disabled) return;
        this.quizScope.sources = selected;
        sync();
        updateCount();
      }).open();
      sync();
    } else {
      const all = sourceActions.createEl("button", { type: "button", text: t("全選択") });
      const clear = sourceActions.createEl("button", { type: "button", text: t("全解除") });
      const sourceRow = sourceGroup.createDiv({ cls: "kokushi-scope-buttons" });
      const buttons = new Map<string, HTMLButtonElement>();
      const apply = (selected: string[] | null): void => {
        this.quizScope.sources = selected;
        for (const [source, button] of buttons) {
          const active = selected === null || selected.includes(source);
          button.classList.toggle("is-selected", active);
          button.setAttribute("aria-pressed", String(active));
        }
        updateCount();
      };
      for (const source of sources) {
        const button = sourceRow.createEl("button", { type: "button", text: source, cls: "kokushi-scope-button" });
        buttons.set(source, button);
        button.onclick = () => {
          const selected = new Set(this.quizScope.sources ?? sources);
          if (selected.has(source)) selected.delete(source);
          else selected.add(source);
          apply(selected.size === sources.length ? null : [...selected]);
        };
      }
      all.onclick = () => apply(null);
      clear.onclick = () => apply([]);
      apply(this.quizScope.sources);
    }

    if (subjects.length) {
      const subjectBlock = root.createDiv({ cls: "kokushi-scope-group kokushi-subject-filter" });
      const subjectHeading = subjectBlock.createDiv({ cls: "kokushi-section-heading" });
      subjectHeading.createEl("h3", { text: t("分野") });
      const choose = subjectHeading.createEl("button", { type: "button", text: t("選択") });
      const summary = subjectBlock.createDiv({ cls: "kokushi-source-summary" });
      const sync = (): void => {
        const selected = this.quizScope.subjects;
        const separator = locale() === "ja" ? "、" : ", ";
        summary.setText(selected === null ? t("すべての分野")
          : selected.length ? selected.map(subjectLabel).join(separator) : t("分野が選択されていません"));
      };
      choose.onclick = () => new SubjectSelectionModal(this.app, subjects, this.quizScope.subjects, selected => {
        if (!root.contains(heading) || refresh.disabled) return;
        this.quizScope.subjects = selected;
        sync();
        updateCount();
      }).open();
      sync();
    }

    const settingsBlock = root.createDiv({ cls: "kokushi-scope-group kokushi-scope-settings" });

    // ========================================
    // 出題順序
    // ========================================

    createButtons(
      createGroup(settingsBlock, t("順序")).row,
      [
        {
          value: "sequential",
          label: t("問題番号順"),
        },
        {
          value: "random",
          label: t("ランダム"),
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

    const targetGroup = createGroup(settingsBlock, t("評価")).row;
    for (const target of ALL_PRACTICE_TARGETS) {
      const button = targetGroup.createEl("button", {
        type: "button",
        text: ratingLabel(target),
        cls: "kokushi-scope-button",
      });
      const sync = (): void => {
        const selected = this.quizScope.targets.includes(target);
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      };
      sync();
      button.onclick = () => {
        const selected = this.quizScope.targets.includes(target);
        this.quizScope.targets = selected
          ? this.quizScope.targets.filter(item => item !== target)
          : [...this.quizScope.targets, target];
        sync();
        updateCount();
      };
    }

    // ========================================
    // 出題問題数
    // ========================================

    const countGroup = createGroup(settingsBlock, t("出題数"));

    createButtons(
      countGroup.row,
      [
        {
          value: "all",
          label: t("すべて"),
        },
        { value: "preset", label: t("{0}問", presetCount) },
        {
          value: "custom",
          label: t("任意"),
        },
      ],
      () => this.quizScope.countMode,
      value => {
        if (
          value === "all" ||
          value === "preset" ||
          value === "custom"
        ) {
          this.quizScope.countMode = value;
        }
      }
    );

    customRow = countGroup.group.createDiv({
      cls: "kokushi-custom-count",
    });

    const customInput =
      customRow.createEl("input", {
        type: "number",
        placeholder: t("例：25"),
      });

    customInput.min = "1";
    customInput.step = "1";
    customInput.inputMode = "numeric";

    customInput.value =
      this.quizScope.customCount;

    if (locale() === "ja") customRow.createSpan().setText("問");

    customInput.addEventListener("input", () => {
      this.quizScope.customCount =
        customInput.value;

      updateCount();
    });

    // プレビューと開始ボタンを末尾へ
    root.appendChild(preview);
    root.appendChild(startButton);
    const dashboard = root.createEl("button", {
      type: "button",
      text: t("ダッシュボードを見る"),
      cls: "kokushi-scope-dashboard",
    });
    dashboard.onclick = () => {
      void this.openDashboard().catch(error => {
        console.error("[Kokushi] Open dashboard error", error);
        new Notice(t("ダッシュボードを開けませんでした。"));
      });
    };

    // ========================================
    // 演習開始
    // ========================================

    startButton.addEventListener("click", () => {
      if (this.saving || this.closing || refresh.disabled) return;
      const units = getFilteredUnits();
      const requested = getRequestedCount(units.reduce((count, unit) => count + unit.length, 0));
      if (requested === null) return;
      if (this.quizScope.order === "random") {
        for (let i = units.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [units[i], units[j]] = [units[j], units[i]];
        }
      }
      const questions = fitQuestionUnits(units, requested);
      if (!questions.length) return;
      this.questions = questions;

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
    this.rating = "unanswered";
    this.saving = false;
  }

  private resetSession(retainClaim?: string): void {
    this.cancelDraftTimer();
    if (this.session && this.session.id !== retainClaim) this.sessionService.releaseDraft(this.session.id);
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

    const { sources, subjects, order, targets } = this.quizScope;
    const startedAt = new Date().toISOString();
    const suffix = Array.from(crypto.getRandomValues(new Uint32Array(2)))
      .map(value => value.toString(16).padStart(8, "0"))
      .join("");

    this.session = {
      id: `${startedAt.replace(/:/g, "-")}_${suffix}`,
      startedAt,
      scope: {
        sources: sources === null ? null : [...sources],
        subjects: subjects === null ? null : [...subjects],
        order, targets: [...targets],
      },
      sourceSessionId,
    };
    this.sessionService.claimDraft(this.session.id, this.leaf);
    this.draftDirty = true;
    void this.flushDraft();
  }

  private createSessionRecord(
    session: NonNullable<QuizView["session"]>,
    status: "in-progress" | "completed"
  ): SessionRecord {
    return {
      ...session,
      schemaVersion: 2,
      recordedAt: new Date().toISOString(),
      status,
      currentIndex: status === "in-progress" ? this.index : undefined,
      result: this.getSessionResult(),
      questions: this.questions.map((question, index) => {
        const state = this.questionStates.get(index);
        return {
          id: question.id,
          source: question.source,
          selected: state?.selected ?? [],
          grade: state?.graded ?? null,
          unknown: state?.unknown ?? false,
          confirmed: state?.confirmed || undefined,
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
            new Notice(t("中断データを保存できませんでした。"));
          }
        }
        return false;
      },
    );
    return this.draftWrite;
  }

  private async flushMemo(): Promise<boolean> {
    const flush = await this.memoEditor;
    return flush ? flush() : true;
  }

  private async leaveSession(): Promise<boolean> {
    if (this.saving || this.closing) return false;
    this.saving = true;
    try {
      return await this.flushMemo() && await this.flushDraft() && !this.closing;
    } finally {
      this.saving = false;
    }
  }

  public async resumeDraft(id: string): Promise<boolean> {
    if (this.session?.id === id && !this.sessionCompleted) return false;
    if (!await this.leaveSession()) return false;

    if (!this.sessionService.claimDraft(id, this.leaf)) {
      new Notice(t("この演習は別のペインで開いています。"));
      return false;
    }

    this.saving = true;
    let adopted = false;
    try {
      const record = await this.sessionService.getSession(id);
      if (this.closing) return false;
      const resumeIndex = record?.status === "in-progress"
        ? record.currentIndex
        : record?.questions.findIndex(question => question.grade === null);
      if (!record || resumeIndex === undefined || resumeIndex < 0) {
        new Notice(t("再開できる演習が見つかりませんでした。"));
        return false;
      }

      const allQuestions = await this.questionService.getQuestions();
      if (this.closing) return false;

      const available = new Map(allQuestions.map(question => [questionKey(question), question]));
      const questions: Question[] = [];
      for (const item of record.questions) {
        const question = available.get(questionKey(item));
        if (!question) {
          new Notice(t("{0}の問題 {1} が見つからないため、演習を再開できません。", item.source, item.id));
          return false;
        }
        questions.push(question);
      }

      if (questions.some((question, index) => {
        const sequence = question.sequence;
        return sequence?.ids.some((id, offset) => {
          const item = questions[index - sequence.index + offset];
          return item?.id !== id || item.path !== question.path;
        });
      })) {
        new Notice(t("連問の構成が変更されたため、この演習を再開できません。"));
        return false;
      }

      if (record.status !== "in-progress") {
        const write = this.sessionService.save({
          ...record,
          questions: record.questions.map(({ id, source, selected, grade, unknown, confirmed }) => ({ id, source, selected, grade, unknown, confirmed })),
          status: "in-progress",
          currentIndex: resumeIndex,
          recordedAt: new Date().toISOString(),
        });
        this.pendingOperation = write;
        await write;
        this.pendingOperation = null;
        if (this.closing) return false;
      }

      this.resetSession(id);
      const { startedAt, scope, sourceSessionId } = record;
      this.session = { id, startedAt, scope, sourceSessionId };
      adopted = true;
      this.quizScope = { ...this.quizScope, sources: scope.sources, subjects: scope.subjects ?? null, order: scope.order, targets: [...scope.targets] };
      this.allQuestions = allQuestions;
      this.questions = questions;
      record.questions.forEach((item, index) => {
        this.questionStates.set(index, {
          selected: [...item.selected],
          unknown: item.unknown,
          graded: item.grade,
          rating: item.rating,
          confirmed: item.confirmed,
        });
      });
      this.index = resumeIndex;
      this.restoreState(this.index);
      await this.renderQuiz(true);
      return true;
    } catch (error) {
      console.error("[Kokushi] Draft resume error", error);
      new Notice(t("演習を再開できませんでした。"));
      return false;
    } finally {
      this.pendingOperation = null;
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
        rating: this.rating,
        confirmed: this.questionStates.get(this.index)?.confirmed,
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
    this.rating = state.rating;
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
    if (this.saving || this.closing || this.sequencePending()) return;
    const destination = this.questions[newIndex];
    if (destination?.sequence && !this.questionStates.get(newIndex)?.graded) newIndex -= destination.sequence.index;

    if (await this.leaveDiscardedSession() || this.saving || this.closing) return;

    if (
      newIndex < 0 ||
      newIndex >= this.questions.length
    ) {
      return;
    }

    this.saving = true;
    try {
      if (!await this.flushMemo() || this.closing) return;
    } finally {
      this.saving = false;
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
    if (this.saving || this.closing || !session || this.sequencePending()) return;

    if (await this.leaveDiscardedSession()) return;
    if (this.saving || this.closing || this.session !== session) return;

    this.saving = true;

    try {
      if (!await this.flushMemo() || this.session !== session || this.closing) return;
      this.saveCurrentState();
      this.cancelDraftTimer();
      const write = this.sessionService.save(this.createSessionRecord(session, "completed"));
      this.pendingOperation = write;
      await write;
      if (this.session !== session) return;
      this.sessionCompleted = true;
      this.sessionService.releaseDraft(session.id);
    } catch (error) {
      console.error("[Kokushi] Session save error", error);
      if (this.draftDirty && !this.closing) this.scheduleDraftSave();
      new Notice(t("演習履歴を保存できませんでした。もう一度お試しください。"));
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

  private sequencePending(): boolean {
    return Boolean(this.getCurrentQuestion()?.sequence && this.graded === null);
  }

  private canSubmit(question: Question): boolean {
    if (this.saving || this.graded !== null) return false;
    if (this.unknown) return true;

    if (question.type === "numeric") {
      return this.selected.length === 1 && /^\d+$/.test(this.selected[0] ?? "");
    }

    const count = this.selected.length;
    return count > 0 && (question.requiredChoices === null || count === question.requiredChoices) &&
      new Set(this.selected).size === count &&
      this.selected.every(id => question.options.some(option => option.id === id));
  }

  // ========================================
  // 問題画面
  //
  // resetScroll:
  // true  = 画面遷移時に最上部へ
  // false = 再描画後も現在位置を維持
  // ========================================

  private async renderQuiz(
    resetScroll = true,
    scrollToFinish = false,
  ): Promise<void> {
    const container = this.contentEl;
    this.memoEditor = null;
    this.stopWatchingImages?.();
    this.stopWatchingImages = null;

    // スクロール位置を保持する再描画に備える
    const previousScroll = container.scrollTop;

    container.empty();

    if (resetScroll) {
      this.resetScroll();
    }

    container.removeClass("kokushi-scope");
    container.addClass("kokushi-quiz");
    container.classList.toggle("kokushi-touch-no-hover", Platform.isIosApp);

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
    if (question.sequence) progress.createSpan({ text: t(" 連問 {0} / {1}", question.sequence.index + 1, question.sequence.ids.length) });

    const headerActions = header.createDiv({ cls: "kokushi-header-actions" });
    if (this.graded !== null) {
      const edit = headerActions.createEl("button", { type: "button", text: t("編集") });
      edit.onclick = () => { void openQuestionEditor(this.app, question.path); };
    }
    const copyButton = headerActions.createEl("button", { type: "button", text: t("コピー") });
    copyButton.disabled = true;

    // ========================================
    // 問題文
    // ========================================

    const questionEl = container.createDiv({ cls: "kokushi-question" });
    await MarkdownRenderer.render(this.app, question.stem, questionEl, question.path, this);

    if (this.closing || !container.contains(questionEl)) return;
    questionEl.querySelectorAll("table").forEach(table => {
      const parent = table.parentElement;
      const wrapper = parent?.classList.contains("table-wrapper") ? parent : questionEl.createDiv();
      wrapper.addClass("kokushi-question-table");
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute("aria-label", t("問題文の表"));
      if (wrapper !== parent) {
        table.before(wrapper);
        wrapper.appendChild(table);
      }
    });
    const stopArranging = arrangeQuestionImages(questionEl);
    const stopPreview = bindImagePreview(this.app, container, question.path);
    this.stopWatchingImages = () => { stopArranging(); stopPreview(); };

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
      this.renderNumericInput(answerEl, updateSubmit, question.excluded);
    } else {
      await this.renderOptions(answerEl, question, updateSubmit);
    }

    if (this.closing || !container.contains(answerEl)) return;
    copyButton.disabled = false;
    copyButton.onclick = () => {
      void copyQuestionText(container.ownerDocument, formatQuestionCopy(question.id, questionEl, answerEl));
    };

    // ========================================
    // 「わからない」ボタン
    // ========================================

    const unknownButton =
      container.createEl("button", {
        text: this.unknown
          ? t("わからない ✓")
          : t("わからない"),
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
          text: question.sequence
            ? question.sequence.index + 1 === question.sequence.ids.length ? t("解答を確定して連問を採点") : t("解答を確定して次へ")
            : t("解答・採点"),
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

        if (question.sequence) await this.confirmSequenceQuestion(question);
        else await this.submitAnswer(question);
        updateSubmit();
      };
    } else {
      this.memoEditor = this.renderResult(container, question);
    }

    // ========================================
    // 前後移動・結果画面ボタン
    // ========================================

    const finishButton = this.renderNavigation(container);

    // ========================================
    // 描画完了後のスクロール位置調整
    // ========================================

    if (scrollToFinish) {
      await this.memoEditor;
      const view = container.ownerDocument.defaultView ?? window;
      view.requestAnimationFrame(() => {
        if (this.closing || !container.contains(finishButton)) return;
        const viewport = view.visualViewport;
        const visibleBottom = Math.min(
          container.getBoundingClientRect().bottom,
          viewport ? viewport.offsetTop + viewport.height : view.innerHeight,
        );
        container.scrollTop = Math.max(
          0,
          container.scrollTop + finishButton.getBoundingClientRect().bottom - visibleBottom,
        );
      });
    } else if (resetScroll) {
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
    updateSubmit: () => void
  ): Promise<void> {
    const required = question.requiredChoices;
    const guide = question.excluded
      ? t("解答を選択してください（採点除外）。")
      : required === null
        ? t("該当するものをすべて選んでください。")
        : t("{0}つ選択してください。", required);

    container.createEl("p", {
      text: guide,
    });

    const inputs: HTMLInputElement[] = [];

    for (const option of question.options) {
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
              required !== null &&
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
    updateSubmit: () => void,
    excluded: boolean,
  ): void {
    container.createEl("p", {
      text: excluded ? t("数値を入力してください（採点除外）。") : t("数値を入力してください。"),
    });

    const input = container.createEl("input", {
      type: "text",
      placeholder: t("数値"),
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

  private async confirmSequenceQuestion(question: Question): Promise<void> {
    const session = this.session;
    const sequence = question.sequence;
    if (!session || !sequence || !this.canSubmit(question) || await this.leaveDiscardedSession() ||
        this.saving || this.closing || this.getCurrentQuestion() !== question) return;

    const index = this.index;
    const first = index - sequence.index;
    this.saving = true;
    try {
      this.saveCurrentState();
      if (sequence.index + 1 < sequence.ids.length) {
        const state = this.questionStates.get(index);
        if (!state) return;
        state.confirmed = true;
        this.index++;
        this.restoreState(this.index);
        this.saving = true;
        this.draftDirty = true;
        if (!await this.flushDraft()) {
          this.index = index;
          this.restoreState(index);
          state.confirmed = false;
          this.draftDirty = true;
          return;
        }
        this.saving = false;
        if (!this.closing) await this.renderQuiz(true);
        return;
      }

      const latest = await this.questionService.reloadFile(question.path);
      const previous = this.questions.slice(first, index + 1);
      if (latest.length !== previous.length || latest.some((updated, offset) => {
        const shown = previous[offset];
        return !shown || updated.id !== shown.id || updated.stem !== shown.stem || updated.type !== shown.type ||
          updated.requiredChoices !== shown.requiredChoices || JSON.stringify(updated.options) !== JSON.stringify(shown.options);
      })) {
        new Notice(t("連問の問題文や入力形式が変更されました。出題範囲に戻り、新しい演習を開始してください。"));
        return;
      }
      this.draftDirty = true;
      if (!await this.flushDraft() || this.closing) return;
      const timestamp = new Date().toISOString();
      const attempts = latest.map((item, offset) => {
        const state = this.questionStates.get(first + offset);
        if (!state || (offset < sequence.index && !state.confirmed)) throw new Error(t("確定済みの小問の解答が見つかりません"));
        const grade = item.excluded ? "excluded" : state.unknown ? "incorrect" : GradingService.grade(item, state.selected);
        return {
          id: item.id, source: item.source, sessionId: session.id, timestamp, selected: state.selected,
          unknown: state.unknown, correct: grade === "excluded" ? null : grade === "correct", rating: defaultRating(grade),
        };
      });
      const write = this.attemptService.saveSequence(attempts);
      this.pendingOperation = write.then(() => {}, () => {});
      const saved = await write;
      if (this.session !== session) return;
      for (const [offset, attempt] of saved.entries()) {
        this.questionStates.set(first + offset, {
          selected: attempt.selected, unknown: attempt.unknown ?? false,
          graded: attemptGrade(attempt), rating: attemptRating(attempt), confirmed: true,
        });
      }
      this.questions.splice(first, latest.length, ...latest);
      this.index = first;
      this.restoreState(first);
      this.scheduleDraftSave(true);
      if (!this.closing) await this.renderQuiz(false, true);
    } catch (error) {
      console.error("[Kokushi] Sequence grading error", error);
      if (!this.closing) new Notice(error instanceof Error ? error.message : t("連問を保存できませんでした。"));
    } finally {
      this.pendingOperation = null;
      this.saving = false;
    }
  }

  private async submitAnswer(
    question: Question
  ): Promise<void> {
    if (!this.canSubmit(question)) {
      return;
    }

    if (await this.leaveDiscardedSession()) return;
    const session = this.session;
    if (!session || this.saving || this.closing || this.getCurrentQuestion() !== question) return;

    this.saving = true;
    let latest: Question;
    try {
      latest = await this.questionService.reload(question);
    } catch (error) {
      this.saving = false;
      const reason = error instanceof Error ? error.message : t("問題を読み込めませんでした");
      if (!this.closing) new Notice(`${question.path} — ${reason}`, 10000);
      return;
    }
    if (this.session !== session || this.closing) {
      this.saving = false;
      return;
    }

    if (latest.sequence) {
      this.saving = false;
      new Notice(t("この問題は連問に変更されました。出題範囲に戻り、新しい演習を開始してください。"));
      return;
    }

    if (latest.type !== question.type || latest.requiredChoices !== question.requiredChoices ||
        latest.stem !== question.stem || JSON.stringify(latest.options) !== JSON.stringify(question.options)) {
      this.questions[this.index] = latest;
      this.saving = false;
      this.resetAnswer();
      this.scheduleDraftSave(true);
      new Notice(t("問題の表示内容または入力形式が更新されました。解答し直してください。"));
      await this.renderQuiz(false);
      return;
    }

    const selected = [...this.selected];
    const result: GradeResult = latest.excluded
      ? "excluded"
      : this.unknown
        ? "incorrect"
        : GradingService.grade(latest, selected);

    try {
      const write = this.attemptService.save({
        id: question.id,
        source: question.source,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        selected,
        unknown: this.unknown,
        rating: defaultRating(result),
        correct:
          result === "excluded"
            ? null
            : result === "correct",
      });
      this.pendingOperation = write;
      await write;
      this.pendingOperation = null;

      if (this.session !== session) return;
      this.questions[this.index] = latest;
      this.graded = result;
      this.rating = defaultRating(result);
      this.saving = false;

      this.saveCurrentState();
      this.scheduleDraftSave(true);
      if (this.closing) return;

      await this.renderQuiz(false, true);
    } catch (error) {
      this.pendingOperation = null;
      console.error(
        "[Kokushi] Attempt save error",
        error
      );

      if (this.session !== session) return;
      this.saving = false;

      new Notice(
        t("解答履歴を保存できませんでした。")
      );

      if (!this.closing) await this.renderQuiz(false);
    }
  }

  // ========================================
  // 採点結果
  // ========================================

  private async renderResult(
    container: HTMLElement,
    question: Question
  ): Promise<(() => Promise<boolean>) | undefined> {
    if (this.graded === null) return;

    const resultEl = container.createDiv({
      cls: `kokushi-result is-${this.graded}`,
    });

    const summary = resultEl.createDiv({ cls: "kokushi-result-heading" });
    summary.createEl("h3", {
      text: gradeLabel(this.graded),
      cls: `kokushi-result-grade is-${this.graded}`,
    });
    if (this.ai?.subjects.length) {
      const fields = this.ai.subjectsOf(question);
      summary.createEl("p", {
        text: t("（分野：{0}）", fields.length ? fields.join(locale() === "ja" ? "／" : " / ") : t("未分類")),
        cls: "kokushi-result-subjects",
      });
    }
    const excluded = this.graded === "excluded" || question.excluded;
    if (!excluded) {
      resultEl.createEl("p", {
        text: t("正答：{0}", this.formatCorrectAnswer(question)),
        cls: "kokushi-result-answer",
      });
    }

    if (this.unknown) {
      resultEl.createEl("p", {
        text: t("「わからない」で解答しました。"),
      });
    }

    if (excluded) {
      resultEl.createEl("p", { text: t("この問題は採点対象外です。") });
    }

    if (question.annotation) {
      const annotation = resultEl.createDiv({ cls: "kokushi-annotation" });
      annotation.createEl("h4", { text: t("注記") });
      const content = annotation.createDiv();
      try {
        await MarkdownRenderer.render(this.app, question.annotation, content, question.path, this);
      } catch (error) {
        console.error("[Kokushi] Annotation render error", error);
        content.setText(question.annotation);
      }
    }
    if (this.closing || !container.contains(resultEl)) return;
    this.renderRating(resultEl, question);

    const studyPanel = resultEl.createDiv({ cls: "kokushi-question-study" });
    return renderQuestionStudy(studyPanel, this.app, question, this.studyService, this.ai);
  }

  private renderRating(root: HTMLElement, question: Question): void {
    const group = root.createDiv({
      cls: "kokushi-scope-buttons kokushi-rating",
      attr: { role: "group", "aria-label": t("本人の評価") },
    });
    const buttons = new Map<PracticeTarget, HTMLButtonElement>();
    for (const rating of ALL_PRACTICE_TARGETS) {
      const button = group.createEl("button", {
        type: "button", text: ratingLabel(rating), cls: "kokushi-scope-button",
      });
      buttons.set(rating, button);
      button.onclick = async () => {
        const session = this.session;
        if (!session || this.saving || this.closing || rating === this.rating || this.getCurrentQuestion() !== question) return;
        this.saving = true;
        buttons.forEach(item => { item.disabled = true; });
        const write = this.attemptService.updateRating(session.id, question, rating);
        this.pendingOperation = write;
        try {
          await write;
          this.rating = rating;
          this.saveCurrentState();
        } catch (error) {
          console.error("[Kokushi] Rating save error", error);
          if (!this.closing) new Notice(t("評価を保存できませんでした。"));
        } finally {
          this.pendingOperation = null;
          this.saving = false;
          buttons.forEach(item => { item.disabled = false; });
          sync();
        }
      };
    }
    const sync = (): void => {
      for (const [rating, button] of buttons) {
        button.classList.toggle("is-selected", rating === this.rating);
        button.setAttribute("aria-pressed", String(rating === this.rating));
      }
    };
    sync();
  }

  // ========================================
  // 問題間ナビゲーション
  // ========================================

  private renderNavigation(container: HTMLElement): HTMLButtonElement {
    const nav = container.createDiv({
      cls: "kokushi-navigation",
    });

    // ----------------------------------------
    // 前の問題
    // ----------------------------------------

    const previousButton = nav.createEl(
      "button",
      {
        text: t("← 前の問題"),
      }
    );

    previousButton.disabled =
      this.index === 0 || this.saving || this.sequencePending();

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
          ? t("演習終了")
          : t("次の問題 →"),

        // 採点済みだけ紫色
        cls: this.graded !== null
          ? "mod-cta"
          : "",
      }
    );

    // 未採点でも移動可能
    nextButton.disabled = this.saving || this.sequencePending();

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

    const scopeButton = container.createEl("button", {
      type: "button",
      text: t("出題範囲の選択に戻る"),
      cls: "kokushi-wide-action",
    });
    scopeButton.disabled = this.saving;
    scopeButton.onclick = () => { void this.openScopeFromDashboard(); };

    const resultButton = container.createEl("button", {
      type: "button",
      text: t("演習を終了する"),
      cls: "kokushi-wide-action kokushi-view-results mod-warning",
    });

    resultButton.disabled = this.saving || this.sequencePending();

    resultButton.onclick = () => {
      void this.openSessionResults();
    };
    return resultButton;
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

    return { correct, incorrect, unanswered, excluded, accuracy: sessionAccuracy(correct, incorrect, excluded) };
  }

  // ========================================
  // 正答表示
  // ========================================

  private formatCorrectAnswer(
    question: Question
  ): string {
    if (question.excluded) {
      return t("採点除外");
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
      .join(t(" または "));
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
        ? t("わからない（未確定）")
        : t("わからない");
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
        return t("正解");

      case "incorrect":
        return t("不正解");

      case "excluded":
        return t("採点除外");

      default:
        return t("未採点");
    }
  }

  // ========================================
  // 演習結果画面
  // ========================================

  private renderFinished(
    container: HTMLElement
  ): void {
    container.empty();

    const heading = container.createDiv({ cls: "kokushi-section-heading" });
    heading.createEl("h2", { text: t("演習結果") });
    const dashboard = heading.createEl("button", { type: "button", text: t("ダッシュボードを見る") });
    dashboard.onclick = () => {
      void this.openDashboard().catch(error => {
        console.error("[Kokushi] Open dashboard error", error);
        new Notice(t("ダッシュボードを開けませんでした。"));
      });
    };

    const total = this.questions.length;

    // ----------------------------------------
    // 問題がない場合
    // ----------------------------------------

    if (total === 0) {
      container.createEl("p", {
        text: t("演習した問題がありません。"),
      });

      const backButton =
        container.createEl("button", {
          text: t("出題範囲に戻る"),
        });

      backButton.onclick = () => {
        void this.openScopeFromDashboard();
      };

      return;
    }

    // ========================================
    // セッション集計
    // ========================================

    const result = this.getSessionResult();

    container.createEl("p", {
      text: t("出題問題数：{0}問", total),
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
      t("正解"),
      t("{0}問", result.correct),
      "is-correct"
    );

    addSummaryCard(
      t("不正解"),
      t("{0}問", result.incorrect),
      "is-incorrect"
    );

    addSummaryCard(
      t("未採点"),
      t("{0}問", result.unanswered),
      "is-unanswered"
    );

    addSummaryCard(
      t("採点除外"),
      t("{0}問", result.excluded),
      "is-excluded"
    );

    // ========================================
    // セッション正答率
    // ========================================

    const rate = container.createDiv({
      cls: "kokushi-session-accuracy",
    });

    rate.createEl("h3", {
      text: t("今回の正答率"),
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
        t("正解扱い {0}問 / 採点済み {1}問", result.correct + result.excluded, result.correct + result.incorrect + result.excluded) +
        t("（採点除外は正解扱い）"),
    });

    // ========================================
    // 問題一覧
    // ========================================

    container.createEl("h3", {
      text: t("演習した問題の一覧"),
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
      t("出典"),
      t("問題番号"),
      t("正答"),
      t("自分の解答"),
      t("正誤"),
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

      row.createEl("td", { text: question.source });
      const idCell = row.createEl("td");

      const linkButton =
        idCell.createEl("button", {
          text: question.id,
          cls: "kokushi-session-question-link",
        });

      linkButton.type = "button";

      linkButton.disabled = Boolean(question.sequence && !state?.graded);
      linkButton.onclick = () => {
        void this.moveToQuestion(i);
      };

      // ------------------------------------
      // 正答
      // ------------------------------------

      row.createEl("td", {
        text: question.sequence && !state?.graded ? "—" : this.formatCorrectAnswer(question),
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

      statusEl.addClass(`is-${state?.graded ?? "unanswered"}`);
    }

    // ========================================
    // 結果画面の操作ボタン
    // ========================================

    const actions = container.createDiv({
      cls: "kokushi-session-actions",
    });

    // ----------------------------------------
    // 同じ問題セットで再演習
    // ----------------------------------------

    const replayActions = actions.createDiv({ cls: "kokushi-session-replay" });
    const restartButton =
      replayActions.createEl("button", {
        text: t("同じ問題でもう一度"),
      });

    restartButton.onclick = () => {
      this.startSession();

      void this.renderQuiz(true);
    };

    const indexes = new Map(this.questions.map((question, index) => [questionKey(question), index]));
    const reviewQuestions = questionUnits(this.questions).filter(unit => unit.some(question => {
      const grade = this.questionStates.get(indexes.get(questionKey(question)) ?? -1)?.graded;
      return grade == null || grade === "incorrect";
    })).flat();
    const review = replayActions.createEl("button", { type: "button", text: t("間違えた問題を復習") });
    review.disabled = reviewQuestions.length === 0;
    review.onclick = () => {
      if (review.disabled) return;
      const sourceSessionId = this.session?.id;
      this.questions = reviewQuestions;
      this.startSession(sourceSessionId);
      void this.renderQuiz(true);
    };

    // ----------------------------------------
    // 出題範囲を選び直す
    // ----------------------------------------

    const scopeButton =
      actions.createEl("button", {
        text: t("出題範囲を選び直す"),
        cls: "mod-cta",
      });

    scopeButton.onclick = () => { void this.openScopeFromDashboard(); };

    const session = this.session;
    if (session) {
      const discard = actions.createEl("button", {
        type: "button", text: t("演習結果を破棄"), cls: "mod-warning",
      });
      discard.onclick = () => {
        new DiscardSessionModal(this.app, async includeAttempts => {
          await this.sessionService.discard(session.id, includeAttempts);
          if (this.session === session) await this.openScopeFromDashboard();
        }, t("演習結果を破棄")).open();
      };
    }
  }

  private async leaveDiscardedSession(): Promise<boolean> {
    if (!this.session || !this.sessionService.isDiscarded(this.session.id)) return false;
    new Notice(t("この演習履歴は破棄されています。"));
    await this.openScopeFromDashboard();
    return true;
  }

  public async refreshPreset(): Promise<void> {
    if (this.contentEl.classList.contains("kokushi-scope") && !this.session && !this.closing) {
      await this.renderScopeSelection();
    }
  }

  public async openScopeFromDashboard(): Promise<void> {
    if (!await this.leaveSession()) return;
    this.questions = [];
    this.resetSession();
    this.quizScope.targets = [...DEFAULT_PRACTICE_TARGETS];
    await this.renderScopeSelection();
  }

  // ========================================
  // ダッシュボードから演習開始
  // ========================================

  public async startFromHistory(record: SessionRecord, mode: HistoryRetryMode = "incorrect"): Promise<boolean> {
    if (!await this.leaveSession()) return false;

    this.saving = true;
    try {
      const allQuestions = await this.questionService.getQuestions();
      if (this.closing) return false;

      const byId = new Map(allQuestions.map(question => [questionKey(question), question]));
      const requested = mode === "all"
        ? record.questions
        : record.questions.filter(question => question.grade === "incorrect");
      const questions = requested.flatMap(item => {
        const question = byId.get(questionKey(item));
        return question ? [question] : [];
      });

      const missing = requested.length - questions.length;
      if (mode === "all" && missing > 0) {
        new Notice(t("{0}問が見つからないため、このセットの再演習を開始できません。", missing));
        return false;
      }

      if (questions.length === 0) {
        new Notice(t("再演習できる問題がありません。"));
        return false;
      }

      if (missing > 0) {
        new Notice(t("{0}問が見つからないため、読み込めた問題で再演習します。", missing));
      }

      this.allQuestions = allQuestions;
      const chosenKeys = new Set(questions.map(questionKey));
      const units = new Map<string, Question[]>();
      for (const unit of questionUnits(allQuestions)) for (const item of unit) units.set(questionKey(item), unit);
      const expanded = new Set<Question[]>();
      for (const question of questions) {
        const unit = units.get(questionKey(question));
        if (unit && (mode !== "all" || unit.every(item => chosenKeys.has(questionKey(item))))) expanded.add(unit);
      }
      if (mode === "all" && [...expanded].flat().length !== questions.length) {
        new Notice(t("連問の構成が変更されたため、このセットで再演習できません。"));
        return false;
      }
      this.questions = [...expanded].flat();
      this.quizScope = {
        sources: null,
        subjects: null,
        order: "sequential",
        targets: mode === "all" ? [...ALL_PRACTICE_TARGETS] : ["wrong"],
        countMode: "all",
        customCount: "25",
      };
      this.startSession(record.id);
      await this.renderQuiz(true);
      return true;
    } catch (error) {
      console.error("[Kokushi] History retry error", error);
      new Notice(t("再演習する問題を読み込めませんでした。"));
      return false;
    } finally {
      this.saving = false;
    }
  }
}
