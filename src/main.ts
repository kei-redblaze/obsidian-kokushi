
import { Notice, Plugin } from "obsidian";

import {
  QuizView,
  VIEW_TYPE_KOKUSHI,
} from "./views/QuizView";

import { QuestionService } from "./services/QuestionService";
import { QuestionStudyService } from "./services/QuestionStudyService";
import { AttemptService } from "./services/AttemptService";
import { SessionService } from "./services/SessionService";

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
    const sessionService = new SessionService(
      this.app.vault,
      id => attemptService.discardSession(id),
      file => this.app.fileManager.trashFile(file),
    );
    try {
      await sessionService.recoverDiscards();
    } catch (error) {
      console.error("[Kokushi] Discard recovery error", error);
      new Notice("保留中の履歴削除を完了できませんでした。");
    }
    const studyService = new QuestionStudyService(this.app);
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void studyService.trackRename(file, oldPath).then(failed => {
        if (failed > 0) new Notice(`${failed}件の問題で関連ノートのパスを更新できませんでした。`);
      }).catch(error => {
        console.error("[Kokushi] Related note rename error", error);
        new Notice("関連ノートのパスを更新できませんでした。");
      });
    }));

    this.registerView(
      VIEW_TYPE_KOKUSHI,
      leaf => new QuizView(
        leaf,
        questionService,
        attemptService,
        sessionService,
        studyService,
        () => this.openDashboard(true)
      )
    );

    this.addRibbonIcon(
      "graduation-cap",
      "演習を開く",
      () => {
        void this.activateQuiz();
      }
    );

    this.addCommand({
      id: "open-quiz",
      name: "演習を開く",
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
        sessionService,

        // 指定した問題へ
        async id => {
          const quiz = await getQuizView();
          await quiz.openQuestionFromDashboard(id);
        },

        async (record, mode) => {
          const quiz = await getQuizView();
          return quiz.startFromHistory(record, mode);
        },

        async id => {
          const quiz = await getQuizView();
          return quiz.resumeDraft(id);
        },

        async id => {
          const leaf = sessionService.getActiveLeaf(id);
          if (!leaf) {
            new Notice("演習画面が見つかりませんでした。");
            return false;
          }
          await this.app.workspace.revealLeaf(leaf);
          return true;
        },

        async () => {
          const quiz = await getQuizView();
          await quiz.openScopeFromDashboard();
        }
      )
    );

    // リボンアイコン
    this.addRibbonIcon(
      "chart-no-axes-combined",
      "ダッシュボード",
      () => {
        void this.openDashboard();
      }
    );

    // コマンドパレット
    this.addCommand({
      id: "open-kokushi-dashboard",
      name: "ダッシュボードを開く",
      callback: () => {
        void this.openDashboard();
      },
    });
  }

  private async openDashboard(showOverview = false): Promise<void> {
    const workspace = this.app.workspace;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
    const leaf = existing ?? workspace.getLeaf("tab");
    if (!existing) {
      await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
    }

    await workspace.revealLeaf(leaf);
    if (showOverview && existing && leaf.view instanceof DashboardView) {
      await leaf.view.showOverview();
    }
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
