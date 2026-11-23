
import { Plugin } from "obsidian";

import {
  QuizView,
  VIEW_TYPE_KOKUSHI,
} from "./views/QuizView";

import { QuestionService } from "./services/QuestionService";
import { AttemptService } from "./services/AttemptService";

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
