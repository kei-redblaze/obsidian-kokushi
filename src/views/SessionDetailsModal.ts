import { App, Modal, Notice } from "obsidian";
import { HistoryRetryMode, SessionRecord } from "../types";
import { SessionService } from "../services/SessionService";
import { DiscardSessionModal } from "./DiscardSessionModal";
import { formatSessionDate } from "./sessionFormatting";

const GRADE_LABELS = {
  correct: "正解",
  incorrect: "不正解",
  excluded: "採点除外",
};

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
    private record: SessionRecord,
    private service: SessionService,
    private actions: SessionDetailActions,
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
