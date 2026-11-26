import { App, Modal, Notice } from "obsidian";
import { KokushiAI } from "../ai/KokushiAI";
import { t } from "../i18n";
import { QuestionService } from "../services/QuestionService";
import type { Question } from "../types";

export class AIControls {
  private listeners = new Set<() => void>();
  private offered = new Set<string>();
  private prompt?: Modal;
  private closed = false;
  private rebuildingOffered = false;
  modelBusy = false;
  classificationBusy = false;
  modelStatus = "";
  classificationStatus = "";

  constructor(
    private app: App,
    private ai: KokushiAI,
    private questions: QuestionService,
    private onClassified: () => void,
  ) {}

  get isReady(): boolean { return this.ai.isReady; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.prompt?.close();
  }

  async prepare(): Promise<void> {
    if (this.closed || this.modelBusy || this.classificationBusy) return;
    this.modelBusy = true;
    this.modelStatus = t("モデルを準備しています…");
    this.notify();
    try {
      await this.ai.prepare((complete, total) => {
        this.modelStatus = t("モデルファイルを読み込み中（{0}/{1}）", complete, total);
        this.notify();
      });
      this.modelStatus = t("モデルは準備できています。");
    } catch (error) {
      console.error("[Kokushi] Model preparation failed", error);
      this.modelStatus = t("モデルを準備できませんでした。端末の空き容量と接続を確認してください。");
    } finally {
      this.modelBusy = false;
      this.notify();
    }
  }

  offerUpdate(questions: readonly Question[]): void {
    if (this.closed || !this.isReady || this.modelBusy || this.classificationBusy || this.prompt || !questions.length) return;
    const rebuild = this.ai.needsReclassification;
    const fresh = this.ai.newQuestionKeys(questions);
    if (rebuild ? this.rebuildingOffered : !fresh.some(key => !this.offered.has(key))) return;
    fresh.forEach(key => this.offered.add(key));
    if (rebuild) this.rebuildingOffered = true;

    const modal = new ClassificationPrompt(this.app, rebuild, () => {
      void this.update(true);
    }, () => { this.prompt = undefined; });
    this.prompt = modal;
    modal.open();
  }

  async update(notifyCompletion = false): Promise<void> {
    if (this.closed || this.modelBusy || this.classificationBusy) return;
    if (!this.isReady) {
      new Notice(t("先にモデルを取得してください。"));
      return;
    }
    this.classificationBusy = true;
    this.classificationStatus = t("分野を分類しています…");
    this.notify();
    try {
      const available = await this.questions.getQuestions();
      await this.ai.loadClassifications();
      await this.ai.classify(available, (complete, total) => {
        this.classificationStatus = complete === 0 ? t("分野を分類しています…") : t("分類中（{0}/{1}）", complete, total);
        this.notify();
      });
      this.classificationStatus = t("分野の分類を更新しました。");
      if (!this.closed) {
        this.onClassified();
        if (notifyCompletion) new Notice(this.classificationStatus);
      }
    } catch (error) {
      if (this.closed) return;
      console.error("[Kokushi] Classification update failed", error);
      this.classificationStatus = t("分野の分類を更新できませんでした。");
      if (!this.isReady) this.modelStatus = "";
      if (notifyCompletion) new Notice(this.classificationStatus);
    } finally {
      this.classificationBusy = false;
      this.notify();
    }
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }
}

class ClassificationPrompt extends Modal {
  constructor(
    app: App,
    private rebuild: boolean,
    private apply: () => void,
    private dismissed: () => void,
  ) { super(app); }

  onOpen(): void {
    this.setTitle(t("分野の分類"));
    this.modalEl.addClass("kokushi-classification-modal");
    this.contentEl.createEl("p", { text: this.rebuild
      ? t("分野の定義が更新されました。問題を再分類しますか？")
      : t("追加された問題があります。分類を実行しますか？") });
    const actions = this.contentEl.createDiv({ cls: "kokushi-history-actions" });
    const later = actions.createEl("button", { type: "button", text: t("後で") });
    const update = actions.createEl("button", { type: "button", cls: "mod-cta", text: t("分類する") });
    later.onclick = () => this.close();
    update.onclick = () => {
      this.close();
      this.apply();
    };
  }

  onClose(): void {
    this.contentEl.empty();
    this.dismissed();
  }
}
