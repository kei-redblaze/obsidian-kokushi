
import {
  ItemView,
  Notice,
  WorkspaceLeaf,
} from "obsidian";

import { QuestionService } from "../services/QuestionService";
import { SessionService } from "../services/SessionService";
import { SessionRecord } from "../types";
import { renderSessionHistory } from "./SessionHistory";
import { renderAttemptHistory, renderInvalidAttempts } from "./AttemptHistory";
import { DASHBOARD_HISTORY_LIMIT } from "../constants";
import {
  StatisticsService,
  DashboardStatistics,
  DailyStatistics,
} from "../services/StatisticsService";

export const VIEW_TYPE_DASHBOARD =
  "kokushi-dashboard";

export type DashboardTarget =
  "unanswered" | "incorrect";

export class DashboardView extends ItemView {
  private renderVersion = 0;
  private page: "dashboard" | "sessions" | "attempts" = "dashboard";
  private period: "7" | "30" | "all" = "30";

  constructor(
    leaf: WorkspaceLeaf,
    private questionService: QuestionService,
    private statisticsService: StatisticsService,
    private sessionService: SessionService,
    private onStartQuiz: (
      target: DashboardTarget
    ) => Promise<void>,
    private onOpenQuestion: (
      id: string
    ) => Promise<void>,
    private onRetrySession: (record: SessionRecord) => Promise<boolean>,
    private onResumeSession: (id: string) => Promise<void>
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText(): string {
    return "ダッシュボード";
  }

  getIcon(): string {
    return "chart-no-axes-combined";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      if (leaf !== this.leaf) return;
      if (this.page === "dashboard") {
        void this.refresh();
      } else {
        void this.openHistory(this.page);
      }
    }));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.renderVersion++;
    this.contentEl.empty();
  }

  // ========================================
  // データの再読み込み
  // ========================================

  private async refresh(): Promise<void> {
    this.page = "dashboard";
    const version = ++this.renderVersion;
    this.contentEl.empty();
    this.contentEl.scrollTop = 0;
    this.contentEl.createEl("p", {
      text: "学習統計を集計しています...",
    });

    try {
      const questions =
        await this.questionService.getQuestions();

      const stats =
        await this.statisticsService.load(
          questions.map(question => question.id)
        );

      if (version === this.renderVersion) this.renderDashboard(stats);
    } catch (error) {
      if (version !== this.renderVersion) return;
      console.error(
        "[Kokushi] Dashboard error",
        error
      );

      this.contentEl.empty();
      this.contentEl.createEl("p", {
        text: "ダッシュボードの読み込みに失敗しました。",
      });

      new Notice(
        "学習統計を取得できませんでした"
      );
    }
  }

  private formatRate(
    value: number | null
  ): string {
    return value === null
      ? "—"
      : `${value.toFixed(1)}%`;
  }

  // ========================================
  // メイン画面
  // ========================================

  private renderDashboard(
    stats: DashboardStatistics
  ): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("kokushi-dashboard");

    root.createEl("h2", {
      text: "ダッシュボード",
    });

    const actions = root.createDiv({
      cls: "kokushi-dashboard-actions",
    });

    const refreshButton = actions.createEl(
      "button",
      { text: "統計を更新" }
    );

    refreshButton.onclick = () => {
      void this.refresh();
    };

    renderInvalidAttempts(root, stats.invalidLines);

    root.createEl("p", {
      text:
        `読み込み済み問題数：` +
        `${stats.totalQuestions}問`,
    });

    // ----------------------------------------
    // 統計カード
    // ----------------------------------------

    const cards = root.createDiv({
      cls: "kokushi-dashboard-cards",
    });

    const addCard = (
      title: string,
      value: string,
      detail: string
    ): void => {
      const card = cards.createDiv({
        cls: "kokushi-dashboard-card",
      });

      card.createEl("p", {
        cls: "kokushi-dashboard-card-title",
        text: title,
      });

      card.createEl("p", {
        cls: "kokushi-dashboard-card-value",
        text: value,
      });

      card.createEl("p", {
        cls: "kokushi-dashboard-card-detail",
        text: detail,
      });
    };

    addCard(
      "学習進捗",
      `${stats.studiedQuestions} / ` +
        `${stats.totalQuestions}`,
      this.formatRate(stats.progressRate)
    );

    addCard(
      "未回答問題",
      `${stats.unansweredQuestions}問`,
      "まだ解答したことのない問題"
    );

    addCard(
      "最新正答率",
      this.formatRate(stats.latestAccuracy),
      `${stats.latestCorrect} / ` +
        `${stats.latestGraded}問`
    );

    addCard(
      "累積正答率",
      this.formatRate(
        stats.cumulativeAccuracy
      ),
      `${stats.cumulativeCorrect} / ` +
        `${stats.cumulativeGraded}回`
    );

    addCard(
      "要復習問題",
      `${stats.reviewQuestions}問`,
      "最新解答が不正解"
    );

    addCard(
      "累積解答数",
      `${stats.totalAttempts}回`,
      "重複解答・採点除外を含む"
    );

    // ----------------------------------------
    // 演習へのショートカット
    // ----------------------------------------

    const quizActions = root.createDiv({
      cls: "kokushi-dashboard-actions",
    });

    const unansweredButton =
      quizActions.createEl("button", {
        text: "未回答問題を演習",
      });

    unansweredButton.disabled =
      stats.unansweredQuestions === 0;

    unansweredButton.onclick = () => {
      void this.onStartQuiz("unanswered");
    };

    const incorrectButton =
      quizActions.createEl("button", {
        text: "要復習問題を演習",
      });

    incorrectButton.disabled =
      stats.reviewQuestions === 0;

    incorrectButton.onclick = () => {
      void this.onStartQuiz("incorrect");
    };

    // ----------------------------------------
    // 学習推移
    // ----------------------------------------

    root.createEl("h3", {
      text: "日別学習推移",
    });

    const periodSelect = root.createEl("select");

    const periods = [
      { value: "7", text: "直近7日" },
      { value: "30", text: "直近30日" },
      { value: "all", text: "全期間" },
    ];

    for (const period of periods) {
      const option =
        periodSelect.createEl("option", {
          text: period.text,
        });

      option.value = period.value;
    }

    periodSelect.value = this.period;

    const chartArea = root.createDiv({
      cls: "kokushi-dashboard-chart-area",
    });

    const updateCharts = (): void => {
      chartArea.empty();

      const days =
        this.period === "all"
          ? stats.daily
          : stats.daily.slice(
              -Number(this.period)
            );

      const attemptsChart = chartArea.createDiv({ cls: "kokushi-dashboard-chart" });
      attemptsChart.createEl("h4", { text: "日別解答回数" });
      this.renderBarChart(attemptsChart, days);

      const accuracyChart = chartArea.createDiv({ cls: "kokushi-dashboard-chart" });
      accuracyChart.createEl("h4", { text: "日別正答率" });
      this.renderLineChart(accuracyChart, days);
    };

    periodSelect.addEventListener(
      "change",
      () => {
        const value = periodSelect.value;

        if (
          value === "7" ||
          value === "30" ||
          value === "all"
        ) {
          this.period = value;
          updateCharts();
        }
      }
    );

    updateCharts();

    const sessionSection = root.createDiv();
    sessionSection.createEl("h3", { text: "演習履歴" });
    void renderSessionHistory(
      sessionSection, this.app, this.sessionService, this.onRetrySession, this.onResumeSession,
      () => { void this.openHistory("sessions"); },
    );

    const attemptSection = root.createDiv();
    attemptSection.createEl("h3", { text: "最近の解答履歴" });
    renderAttemptHistory(attemptSection, stats.recent, stats.availableIds, this.onOpenQuestion);
    if (stats.totalAttempts > DASHBOARD_HISTORY_LIMIT) {
      const more = attemptSection.createEl("button", {
        text: "すべて表示",
        attr: { "aria-label": "解答履歴をすべて表示" },
      });
      more.type = "button";
      more.onclick = () => { void this.openHistory("attempts"); };
    }
  }

  private async openHistory(kind: "sessions" | "attempts"): Promise<void> {
    this.page = kind;
    const version = ++this.renderVersion;
    const root = this.contentEl;
    root.empty();
    root.scrollTop = 0;
    const heading = root.createEl("h2", {
      text: kind === "sessions" ? "演習履歴" : "解答履歴",
      attr: { tabindex: "-1" },
    });
    heading.focus();
    const back = root.createEl("button", { text: "ダッシュボードに戻る" });
    back.type = "button";
    back.onclick = () => { void this.refresh(); };

    const content = root.createDiv({ cls: "kokushi-history-page" });
    if (kind === "sessions") {
      await renderSessionHistory(content, this.app, this.sessionService, this.onRetrySession, this.onResumeSession);
      return;
    }

    const status = content.createEl("p", { text: "解答履歴を読み込んでいます…" });
    try {
      const [questions, history] = await Promise.all([
        this.questionService.getQuestions(),
        this.statisticsService.getAttemptHistory(),
      ]);
      if (version !== this.renderVersion) return;
      status.remove();
      renderInvalidAttempts(content, history.invalidLines);
      renderAttemptHistory(
        content, history.attempts, new Set(questions.map(question => question.id)), this.onOpenQuestion,
      );
    } catch (error) {
      if (version !== this.renderVersion) return;
      console.error("[Kokushi] Attempt history load error", error);
      status.setText("解答履歴を読み込めませんでした。");
      status.addClass("kokushi-dashboard-warning");
    }
  }

  // ========================================
  // SVGグラフ共通処理
  // ========================================

  private createChartSvg(
    root: HTMLElement,
    days: DailyStatistics[]
  ): {
    svg: SVGSVGElement;
    width: number;
    height: number;
  } {
    const wrapper = root.createDiv({
      cls: "kokushi-dashboard-chart-scroll",
    });

    const width = Math.max(360, days.length * 14 + 60);
    if (days.length > 30) {
      wrapper.addClass("is-wide");
      wrapper.setCssProps({ "--kokushi-chart-width": `${width}px` });
    }

    const height = 190;

    const svg = createSvg("svg");

    svg.setAttribute(
      "viewBox",
      `0 0 ${width} ${height}`
    );

    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(height));

    svg.setAttribute(
      "preserveAspectRatio",
      "xMidYMid meet"
    );

    svg.setAttribute("role", "img");
    wrapper.appendChild(svg);

    return { svg, width, height };
  }

  private addSvgElement(
    svg: SVGSVGElement,
    tag: "rect" | "line" | "circle" | "text",
    attributes: Record<string, string>,
    text?: string
  ): void {
    const element = createSvg(tag);

    for (const [name, value] of Object.entries(
      attributes
    )) {
      element.setAttribute(name, value);
    }

    if (text !== undefined) {
      element.textContent = text;
    }

    svg.appendChild(element);
  }

  // ========================================
  // 日別解答回数
  // ========================================

  private renderBarChart(
    root: HTMLElement,
    days: DailyStatistics[]
  ): void {
    const { svg, width } =
      this.createChartSvg(root, days);

    const top = 15;
    const bottom = 155;
    const left = 40;
    const right = width - 15;

    const plotHeight = bottom - top;
    const plotWidth = right - left;

    const maximum = Math.max(
      1,
      ...days.map(day => day.attempts)
    );

    const step = plotWidth /
      Math.max(days.length, 1);

    const barWidth = Math.max(
      2,
      Math.min(15, step * 0.7)
    );

    this.addSvgElement(svg, "line", {
      x1: String(left),
      y1: String(bottom),
      x2: String(right),
      y2: String(bottom),
      stroke: "currentColor",
      "stroke-opacity": "0.4",
    });

    days.forEach((day, index) => {
      const height =
        day.attempts / maximum * plotHeight;

      const x =
        left + index * step +
        (step - barWidth) / 2;

      const y = bottom - height;

      this.addSvgElement(svg, "rect", {
        x: String(x),
        y: String(y),
        width: String(barWidth),
        height: String(height),
        rx: "2",
        fill: "var(--interactive-accent)",
      });

      const labelInterval = Math.max(
        1,
        Math.ceil(days.length / 8)
      );

      if (index % labelInterval === 0) {
        this.addSvgElement(
          svg,
          "text",
          {
            x: String(x),
            y: "176",
            fill: "currentColor",
            "font-size": "10",
          },
          day.date.slice(5)
        );
      }
    });

    root.createEl("p", {
      cls: "kokushi-dashboard-chart-caption",
      text:
        "縦軸：解答回数 " +
        `（最大 ${maximum}回）`,
    });
  }

  // ========================================
  // 日別正答率
  // ========================================

  private renderLineChart(
    root: HTMLElement,
    days: DailyStatistics[]
  ): void {
    const { svg, width } =
      this.createChartSvg(root, days);

    const top = 15;
    const bottom = 155;
    const left = 40;
    const right = width - 15;

    const plotWidth = right - left;
    const plotHeight = bottom - top;

    const step =
      plotWidth /
      Math.max(days.length - 1, 1);
    
    const labelInterval = Math.max(
      1,
      Math.ceil(days.length / 8)
    );

    // データポイントのX座標
    const getX = (index: number): number => {
      if (days.length === 1) {
        return left + plotWidth / 2;
      }

      return left + index * step;
    };

    // -----------------------------–-------------------------
    // 縦軸・グリッド線
    // -------------------------------------------------------

    for (const rate of [0, 50, 100]) {
      const y =
        bottom - rate / 100 * plotHeight;

      this.addSvgElement(svg, "line", {
        x1: String(left),
        y1: String(y),
        x2: String(right),
        y2: String(y),
        stroke: "currentColor",
        "stroke-opacity": "0.15",
      });

      this.addSvgElement(
        svg,
        "text",
        {
          x: "2",
          y: String(y + 4),
          fill: "currentColor",
          "font-size": "11",
        },
        `${rate}%`
      );
    }

    // --------------------------------------------------------
    // 折れ線・データポイント
    // --------------------------------------------------------

    let previous:
      { x: number; y: number } | null = null;

    days.forEach((day, index) => {
      const x = getX(index);

      if (day.accuracy === null) {
        // 採点対象の解答がない日は線を切る
        previous = null;
        return;
      }

      const y =
        bottom -
        day.accuracy / 100 * plotHeight;

      if (previous) {
        this.addSvgElement(svg, "line", {
          x1: String(previous.x),
          y1: String(previous.y),
          x2: String(x),
          y2: String(y),
          stroke: "var(--interactive-accent)",
          "stroke-width": "2",
        });
      }

      this.addSvgElement(svg, "circle", {
        cx: String(x),
        cy: String(y),
        r: "3",
        fill: "var(--interactive-accent)",
      });

      previous = { x, y };
    });

    // -------------------------------------------------------
    // 横軸の日付ラベル
    // -------------------------------------------------------

    days.forEach((day, index) => {
      const isFirst = index === 0;
      const isLast = index === days.length - 1;

      const showLabel =
        isFirst ||
        isLast ||
        (
          index % labelInterval === 0 &&
          days.length - 1 - index >= labelInterval
        );

      if (!showLabel) {
        return;
      }

      const x = getX(index);

      const textAnchor =
        days.length === 1
          ? "middle"
          : isFirst
            ? "start"
            : isLast
              ? "end"
              : "middle";
              
      this.addSvgElement(
        svg,
        "text",
        {
          x: String(x),
          y: "176",
          fill: "currentColor",
          "font-size": "10",
          "text-anchor": textAnchor,
        },
        day.date.slice(5)
      );
    });

    root.createEl("p", {
      cls: "kokushi-dashboard-chart-caption",
      text:
        "採点対象の解答がない日は" +
        "正答率を表示しません。",
    });
  }
}
