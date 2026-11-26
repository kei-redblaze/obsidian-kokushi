
import { Notice, Plugin } from "obsidian";
import { KokushiAI } from "./ai/KokushiAI";
import { setLanguagePreference, t } from "./i18n";

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

import { AIControls } from "./views/AIControls";
import { KokushiSettingTab } from "./views/KokushiSettings";
import { installAppearance, readPreferences } from "./views/KokushiAppearance";

export default class KokushiPlugin extends Plugin {
  async onload(): Promise<void> {
    const questionService =
      new QuestionService(this.app);

    let preferences = readPreferences(await this.loadData());
    setLanguagePreference(preferences.language);
    const ai = new KokushiAI(this.app);
    await ai.loadClassifications();
    this.register(() => ai.close());
    const refreshScopes = (reloadQuestions = false): void => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_KOKUSHI)) {
        if (leaf.view instanceof QuizView) {
          const task = reloadQuestions ? leaf.view.refreshScopeQuestions() : leaf.view.refreshPreset();
          void task.catch((error: unknown) => { console.error("[Kokushi] Scope refresh error", error); });
        }
      }
    };
    const aiControls = new AIControls(this.app, ai, questionService, () => refreshScopes(true));
    this.register(() => aiControls.close());
    const appearance = installAppearance(this.app, preferences);
    this.register(() => appearance.clear());
    let pendingPreferences = Promise.resolve();
    this.addSettingTab(new KokushiSettingTab(this.app, this, questionService, preferences, change => {
      const task = pendingPreferences.then(async () => {
        const next = readPreferences({ ...preferences, ...change });
        await this.saveData(next);
        const presetChanged = preferences.presetCount !== next.presetCount;
        preferences = next;
        appearance.update(next);
        if (presetChanged) refreshScopes();
        return next;
      });
      pendingPreferences = task.then(() => {}, () => {});
      return task.catch((error: unknown) => {
        console.error("[Kokushi] Settings save error", error);
        new Notice(t("設定を保存できませんでした。"));
        return null;
      });
    }, aiControls));

    const attemptService =
      new AttemptService(this.app);
    const sessionService = new SessionService(
      this.app.vault,
      attemptService,
      file => this.app.fileManager.trashFile(file),
    );
    try {
      await sessionService.recoverDiscards();
    } catch (error) {
      console.error("[Kokushi] Discard recovery error", error);
      new Notice(t("保留中の履歴削除を完了できませんでした。"));
    }
    const studyService = new QuestionStudyService(this.app);
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void studyService.trackRename(file, oldPath).then(failed => {
        if (failed > 0) new Notice(t("{0}件の問題で関連ノートのパスを更新できませんでした。", failed));
      }).catch(error => {
        console.error("[Kokushi] Related note rename error", error);
        new Notice(t("関連ノートのパスを更新できませんでした。"));
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
        () => this.openDashboard(true),
        ai,
        questions => aiControls.offerUpdate(questions)
      )
    );

    this.addRibbonIcon(
      "graduation-cap",
      t("演習を開く"),
      () => {
        void this.activateQuiz();
      }
    );

    this.addCommand({
      id: "open-quiz",
      name: t("演習を開く"),
      callback: () => {
        void this.activateQuiz();
      },
    });

    const statisticsService =
      new StatisticsService(attemptService);

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
          t("QuizViewの取得に失敗しました")
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
            new Notice(t("演習画面が見つかりませんでした。"));
            return false;
          }
          await this.app.workspace.revealLeaf(leaf);
          return true;
        },

        async () => {
          const quiz = await getQuizView();
          await quiz.openScopeFromDashboard();
        },
        questions => aiControls.offerUpdate(questions)
      )
    );

    // リボンアイコン
    this.addRibbonIcon(
      "chart-no-axes-combined",
      t("ダッシュボード"),
      () => {
        void this.openDashboard();
      }
    );

    // コマンドパレット
    this.addCommand({
      id: "open-kokushi-dashboard",
      name: t("ダッシュボードを開く"),
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
    if (existing.length && leaf.view instanceof QuizView) await leaf.view.refreshScopeQuestions();
  }
}
