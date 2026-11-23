
import { Plugin } from "obsidian";

import {
  QuizView,
  VIEW_TYPE_KOKUSHI,
} from "./views/QuizView";

import { QuestionService } from "./services/QuestionService";
import { AttemptService } from "./services/AttemptService";

import {
  DashboardView,
  VIEW_TYPE_DASHBOARD,
} from "./views/DashboardView";

import {
  StatisticsService,
} from "./services/StatisticsService";

export default class KokushiPlugin extends Plugin {
  async onload(): Promise<void> {
    const questionService =
      new QuestionService(this.app);

    const attemptService =
      new AttemptService(this.app);

    this.registerView(
      VIEW_TYPE_KOKUSHI,
      leaf => new QuizView(
        leaf,
        questionService,
        attemptService
      )
    );

    this.addRibbonIcon(
      "graduation-cap",
      "国試演習を開く",
      () => {
        void this.activateQuiz();
      }
    );

    this.addCommand({
      id: "open-quiz",
      name: "国試演習を開く",
      callback: () => {
        void this.activateQuiz();
      },
    });

    const statisticsService =
      new StatisticsService(this.app);

    // 既存のQuizViewを開く共通処理
    const getQuizView = async (): Promise<QuizView> => {
      const workspace = this.app.workspace;

      const leaf =
        workspace.getLeavesOfType(
          VIEW_TYPE_KOKUSHI
        )[0] ?? workspace.getLeaf("tab");

      if (
        leaf.getViewState().type !==
        VIEW_TYPE_KOKUSHI
      ) {
        await leaf.setViewState({
          type: VIEW_TYPE_KOKUSHI,
          active: true,
        });
      }

      await workspace.revealLeaf(leaf);

      if (!(leaf.view instanceof QuizView)) {
        throw new Error(
          "QuizViewの取得に失敗しました"
        );
      }
    
      return leaf.view;
    };

    // ダッシュボードビューを登録
    this.registerView(
      VIEW_TYPE_DASHBOARD,
      leaf => new DashboardView(
        leaf,
        questionService,
        statisticsService,

        // 未回答・誤答演習へ
        async target => {
          const quiz = await getQuizView();
          await quiz.startFromDashboard(target);
        },

        // 指定した問題へ
        async id => {
          const quiz = await getQuizView();
          await quiz.openQuestionFromDashboard(id);
        }
      )
    );

    // ダッシュボードを開く
    const openDashboard = async (): Promise<void> => {
      const workspace = this.app.workspace;

      const leaf =
        workspace.getLeavesOfType(
          VIEW_TYPE_DASHBOARD
        )[0] ?? workspace.getLeaf("tab");

      if (
        leaf.getViewState().type !==
        VIEW_TYPE_DASHBOARD
      ) {
        await leaf.setViewState({
          type: VIEW_TYPE_DASHBOARD,
          active: true,
        });
      }

      await workspace.revealLeaf(leaf);
    };

    // リボンアイコン
    this.addRibbonIcon(
      "chart-no-axes-combined",
      "国試ダッシュボード",
      () => {
        void openDashboard();
      }
    );

    // コマンドパレット
    this.addCommand({
      id: "open-kokushi-dashboard",
      name: "国試ダッシュボードを開く",
      callback: () => {
        void openDashboard();
      },
    });
  }

  private async activateQuiz(): Promise<void> {
    const workspace = this.app.workspace;

    const existing =
      workspace.getLeavesOfType(VIEW_TYPE_KOKUSHI);

    const leaf = existing[0] ??
      workspace.getLeaf("tab");

    if (existing.length === 0) {
      await leaf.setViewState({
        type: VIEW_TYPE_KOKUSHI,
        active: true,
      });
    }

    await workspace.revealLeaf(leaf);
  }
}
