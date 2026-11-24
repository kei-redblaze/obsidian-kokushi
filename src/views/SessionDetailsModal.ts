import { App, Modal, Notice } from "obsidian";
import { HistoryRetryMode, SessionRecord } from "../types";
import { formatSessionDate } from "./sessionFormatting";

const GRADE_LABELS = {
  correct: "正解",
  incorrect: "不正解",
  excluded: "採点除外",
};

export class SessionDetailsModal extends Modal {
  constructor(
    app: App,
    private record: SessionRecord,
    private onRetry: (record: SessionRecord, mode: HistoryRetryMode) => Promise<boolean>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { startedAt, scope, result, questions } = this.record;
    this.setTitle("演習履歴の詳細");
    const root = this.contentEl;
    root.createEl("p", { text: `開始日時 ${formatSessionDate(startedAt)}` });

    const sources = scope.exams ?? [...new Set(questions.map(question => question.id.replace(/[A-F].*$/, "")))];
    root.createEl("p", {
      text: `出典 ${sources.map(exam => `第${exam}回`).join("、")}`,
    });
    const percentage = result.accuracy === null ? "—" : `${result.accuracy.toFixed(1)}%`;
    root.createEl("p", {
      text: `全${questions.length}問、正解${result.correct}問、不正解${result.incorrect}問、` +
        `未採点${result.unanswered}問、採点除外${result.excluded}問、正答率 ${percentage}`,
    });

    const actions = root.createDiv({ cls: "kokushi-history-actions" });
    const retrySet = actions.createEl("button", { type: "button", text: "このセットで再演習", cls: "mod-cta" });
    const retryIncorrect = result.incorrect > 0
      ? actions.createEl("button", { type: "button", text: "この回の誤答を再演習" })
      : null;

    const retry = async (mode: HistoryRetryMode): Promise<void> => {
      if (retrySet.disabled) return;
      retrySet.disabled = true;
      if (retryIncorrect) retryIncorrect.disabled = true;
      try {
        if (await this.onRetry(this.record, mode)) this.close();
      } catch (error) {
        console.error("[Kokushi] History retry error", error);
        new Notice("演習画面を開けませんでした。");
      } finally {
        retrySet.disabled = false;
        if (retryIncorrect) retryIncorrect.disabled = false;
      }
    };
    retrySet.onclick = () => { void retry("all"); };
    if (retryIncorrect) retryIncorrect.onclick = () => { void retry("incorrect"); };

    const wrapper = root.createDiv({ cls: "kokushi-session-table-wrapper" });
    const table = wrapper.createEl("table", { cls: "kokushi-session-table" });
    const header = table.createEl("thead").createEl("tr");
    for (const label of ["問題番号", "自分の解答", "採点結果"]) {
      header.createEl("th", { text: label, attr: { scope: "col" } });
    }

    const body = table.createEl("tbody");
    for (const question of questions) {
      const row = body.createEl("tr");
      row.createEl("td", { text: question.id });
      const selected = question.unknown ? "わからない" : question.selected.join(", ") || "—";
      row.createEl("td", { text: selected });
      row.createEl("td", {
        text: question.grade === null ? "未採点" : GRADE_LABELS[question.grade],
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
