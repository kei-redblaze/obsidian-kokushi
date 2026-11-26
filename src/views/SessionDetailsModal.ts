import { bindAppearance, unbindAppearance } from "./KokushiAppearance";
import { App, Modal, Notice } from "obsidian";
import { HistoryRetryMode, SessionDetails, SessionRecord } from "../types";
import { SessionService } from "../services/SessionService";
import { DiscardSessionModal } from "./DiscardSessionModal";
import { PRACTICE_TARGET_LABELS } from "../services/PracticeTargets";
import { renderHistoryDate, renderHistoryGrade } from "./sessionFormatting";

export interface SessionDetailActions {
  retry: (record: SessionRecord, mode: HistoryRetryMode) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  showActive?: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export async function openSessionDetails(
  app: App, service: SessionService, id: string, actions: SessionDetailActions,
): Promise<void> {
  try {
    const record = await service.getSession(id);
    if (!record) {
      new Notice("演習履歴が見つかりませんでした。");
      await actions.refresh();
      return;
    }
    new SessionDetailsModal(app, record, service, actions).open();
  } catch (error) {
    console.error("[Kokushi] Session details error", error);
    new Notice("演習履歴を開けませんでした。");
  }
}

export class SessionDetailsModal extends Modal {
  constructor(
    app: App,
    private record: SessionDetails,
    private service: SessionService,
    private actions: SessionDetailActions,
  ) {
    super(app);
  }

  onOpen(): void {
    bindAppearance(this.app, this.modalEl);
    const { startedAt, result, questions } = this.record;
    this.setTitle("演習履歴の詳細");
    const root = this.contentEl;
    const date = root.createEl("p", { text: "開始日時" });
    renderHistoryDate(date, startedAt);

    const sources = [...new Set(questions.map(question => question.source))];
    root.createEl("p", { text: `出典 ${sources.join("、")}` });
    const percentage = result.accuracy === null ? "—" : `${result.accuracy.toFixed(1)}%`;
    const summary = root.createEl("p", { text: `全${questions.length}問、正解` });
    summary.createSpan({ text: String(result.correct), cls: "kokushi-result-grade is-correct" });
    summary.createSpan({ text: "問、不正解" });
    summary.createSpan({ text: String(result.incorrect), cls: "kokushi-result-grade is-incorrect" });
    summary.createSpan({
      text: `問、未採点${result.unanswered}問、採点除外${result.excluded}問、正答率 ${percentage}`,
    });

    const actions = root.createDiv({ cls: "kokushi-history-actions" });
    const status = this.service.getStatus(this.record);
    const addAction = (text: string, run: () => Promise<boolean>, cls = ""): void => {
      const button = actions.createEl("button", { type: "button", text, cls });
      button.onclick = async () => {
        if (button.disabled) return;
        const buttons = actions.querySelectorAll("button");
        buttons.forEach(item => { item.disabled = true; });
        try {
          if (await run()) this.close();
        } catch (error) {
          console.error("[Kokushi] Session action error", error);
          new Notice("演習画面を開けませんでした。");
        } finally {
          buttons.forEach(item => { item.disabled = false; });
        }
      };
    };

    if (status === "active") {
      const showActive = this.actions.showActive;
      if (showActive) addAction("演習に戻る", () => showActive(this.record.id), "mod-cta");
    } else {
      if (status === "interrupted") {
        addAction("再開", () => this.actions.resume(this.record.id), "mod-cta");
      } else {
        if (questions.some(question => question.grade === null)) {
          addAction("再開", () => this.actions.resume(this.record.id), "mod-cta");
        }
        addAction("このセットで再演習", () => this.actions.retry(this.record, "all"));
        if (result.incorrect > 0) {
          addAction("この回の誤答を再演習", () => this.actions.retry(this.record, "incorrect"));
        }
      }

      const discard = actions.createEl("button", { type: "button", text: "演習履歴を破棄", cls: "mod-warning" });
      discard.onclick = () => {
        new DiscardSessionModal(this.app, async includeAttempts => {
          await this.service.discard(this.record.id, includeAttempts);
          this.close();
          void this.actions.refresh().catch(error => {
            console.error("[Kokushi] History refresh error", error);
            new Notice("履歴の表示を更新できませんでした。");
          });
        }).open();
      };
    }

    const wrapper = root.createDiv({ cls: "kokushi-session-table-wrapper" });
    const table = wrapper.createEl("table", { cls: "kokushi-session-table" });
    const header = table.createEl("thead").createEl("tr");
    for (const label of ["出典", "問題番号", "自分の解答", "評価", "採点結果"]) {
      header.createEl("th", { text: label, attr: { scope: "col" } });
    }

    const body = table.createEl("tbody");
    for (const question of questions) {
      const row = body.createEl("tr");
      row.createEl("td", { text: question.source });
      row.createEl("td", { text: question.id });
      const selected = question.unknown ? "わからない" : question.selected.join(", ") || "—";
      row.createEl("td", { text: selected });
      row.createEl("td", { text: PRACTICE_TARGET_LABELS[question.rating] });
      renderHistoryGrade(row.createEl("td"), question.grade);
    }
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.contentEl.empty();
  }
}
