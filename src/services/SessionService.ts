import { TFile, TFolder, Vault, WorkspaceLeaf } from "obsidian";
import { ATTEMPTS_FOLDER, PATHS } from "../constants";
import { SessionDetails, SessionRecord, SessionResult } from "../types";
import { isQuestionReference, questionKey } from "./QuestionIdentity";
import { ensureFolder } from "./VaultFolder";
import { AttemptService } from "./AttemptService";
import { ALL_PRACTICE_TARGETS, defaultRating, isPracticeTarget } from "./PracticeTargets";

export interface SessionSummary {
  id: string;
  startedAt: string;
  total: number;
  result: SessionResult;
  status: "completed" | "interrupted" | "active";
}

export interface DraftSummary {
  id: string;
  recordedAt: string;
  currentIndex: number;
  total: number;
}

const SESSION_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_[a-f0-9]{16}$/;

export class SessionService {
  private pending: Promise<void> = Promise.resolve();
  private activeDrafts = new Map<string, WorkspaceLeaf>();
  private discarding = new Set<string>();
  private discarded = new Set<string>();

  constructor(
    private vault: Vault,
    private attempts: AttemptService,
    private trashFile: (file: TFile) => Promise<void>,
  ) {}

  isDiscarded(id: string): boolean {
    return this.discarding.has(id) || this.discarded.has(id);
  }

  claimDraft(id: string, leaf: WorkspaceLeaf): boolean {
    if (this.activeDrafts.has(id) || this.isDiscarded(id)) return false;
    this.activeDrafts.set(id, leaf);
    return true;
  }

  getActiveLeaf(id: string): WorkspaceLeaf | undefined {
    return this.activeDrafts.get(id);
  }

  getStatus(record: SessionRecord): SessionSummary["status"] {
    if (record.status !== "in-progress") return "completed";
    return this.activeDrafts.has(record.id) ? "active" : "interrupted";
  }

  releaseDraft(id: string): void {
    this.activeDrafts.delete(id);
  }

  save(session: SessionRecord): Promise<void> {
    if (!SESSION_ID.test(session.id)) throw new Error("演習履歴IDが不正です");

    const task = this.pending.then(async () => {
      if (this.discarded.has(session.id)) throw new Error("演習履歴は破棄されています");
      await ensureFolder(this.vault, ATTEMPTS_FOLDER);
      await ensureFolder(this.vault, PATHS.sessions);
      const path = `${PATHS.sessions}/${session.id}.json`;
      const existing = this.vault.getAbstractFileByPath(path);
      const content = JSON.stringify(session, null, 2) + "\n";

      if (existing instanceof TFile) {
        await this.vault.modify(existing, content);
      } else {
        await this.vault.create(path, content);
      }
    });
    this.pending = task.catch(() => {});
    return task;
  }

  async discard(id: string, includeAttempts: boolean): Promise<void> {
    if (!SESSION_ID.test(id) || this.activeDrafts.has(id) || this.discarding.has(id)) {
      throw new Error("この演習は破棄できません");
    }
    this.discarding.add(id);

    const task = this.pending.then(async () => {
      const path = `${PATHS.sessions}/${id}.json`;
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error("演習履歴が見つかりません");

      if (!includeAttempts) {
        await this.trashFile(file);
        return;
      }

      // 再起動時にも処理を続けられるよう、先に削除予定のファイル名へ移す。
      const staged = `${PATHS.sessions}/${id}.discarding.json`;
      if (this.vault.getAbstractFileByPath(staged)) throw new Error("削除処理がすでに登録されています");
      await this.vault.rename(file, staged);
      try {
        await this.attempts.discardSession(id);
      } catch (error) {
        await this.vault.rename(file, path);
        throw error;
      }
      await this.finishDiscard(file);
    });
    this.pending = task.catch(() => {});
    try {
      await task;
      this.discarded.add(id);
    } finally {
      this.discarding.delete(id);
    }
  }

  async recoverDiscards(): Promise<void> {
    const folder = this.vault.getAbstractFileByPath(PATHS.sessions);
    if (!(folder instanceof TFolder)) return;

    for (const file of [...folder.children]) {
      if (!(file instanceof TFile) || file.extension !== "json" || !file.basename.endsWith(".discarding")) continue;
      const id = file.basename.slice(0, -".discarding".length);
      if (!SESSION_ID.test(id)) continue;
      await this.attempts.discardSession(id);
      this.discarded.add(id);
      await this.finishDiscard(file);
    }
  }

  private async finishDiscard(file: TFile): Promise<void> {
    try {
      await this.trashFile(file);
    } catch (error) {
      // 一覧からは除外済み。次の起動時にファイルの破棄を再試行する。
      console.error("[Kokushi] Discard cleanup error", error);
    }
  }

  async getSession(id: string): Promise<SessionDetails | null> {
    if (!SESSION_ID.test(id)) return null;
    await this.pending;
    const file = this.vault.getAbstractFileByPath(`${PATHS.sessions}/${id}.json`);
    if (!(file instanceof TFile)) return null;
    const [record, ratings] = await Promise.all([this.readSession(file), this.attempts.getSessionRatings(id)]);
    return {
      ...record,
      questions: record.questions.map(question => ({
        ...question,
        rating: question.grade === null ? "unanswered" : ratings.get(questionKey(question)) ?? defaultRating(question.grade),
      })),
    };
  }

  async getDrafts(): Promise<DraftSummary[]> {
    await this.pending;
    const drafts: DraftSummary[] = [];

    for (const file of this.getFiles()) {
      if (this.activeDrafts.has(file.basename)) continue;
      let record: SessionRecord;
      try {
        record = await this.readSession(file);
      } catch {
        // 読み込めない行はダッシュボードの履歴で通知する。
        continue;
      }
      if (record.status === "in-progress" && record.currentIndex !== undefined) {
        drafts.push({
          id: record.id,
          recordedAt: record.recordedAt,
          currentIndex: record.currentIndex,
          total: record.questions.length,
        });
      }
    }

    return drafts.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  async getHistory(limit = Infinity): Promise<{
    sessions: SessionSummary[];
    invalid: number;
    hasMore: boolean;
  }> {
    await this.pending;
    const sessions: SessionSummary[] = [];
    let invalid = 0;

    for (const file of this.getFiles()) {
      try {
        const record = await this.readSession(file);
        if (sessions.length === limit) return { sessions, invalid, hasMore: true };

        sessions.push({
          id: record.id,
          startedAt: record.startedAt,
          total: record.questions.length,
          result: record.result,
          status: this.getStatus(record),
        });
      } catch {
        invalid++;
      }
    }

    return { sessions, invalid, hasMore: false };
  }

  private getFiles(): TFile[] {
    const folder = this.vault.getAbstractFileByPath(PATHS.sessions);
    if (folder === null) return [];
    if (!(folder instanceof TFolder)) {
      throw new Error("演習履歴の保存先がフォルダーではありません");
    }

    return folder.children
      .filter((file): file is TFile =>
        file instanceof TFile && file.extension === "json" && SESSION_ID.test(file.basename)
      )
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  private async readSession(file: TFile): Promise<SessionRecord> {
    const value: unknown = JSON.parse(await this.vault.cachedRead(file));
    normalizeLegacyScope(value);
    if (!isSessionRecord(value, file.basename)) throw new Error("演習履歴の形式が不正です");
    const { correct, incorrect, excluded } = value.result;
    return { ...value, result: { ...value.result, accuracy: sessionAccuracy(correct, incorrect, excluded) } };
  }
}

function isSessionRecord(value: unknown, id: string): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const { schemaVersion, startedAt, recordedAt, questions, result, scope, status, currentIndex, sourceSessionId } =
    value as Partial<SessionRecord>;
  if (
    schemaVersion !== 2 ||
    (value as Partial<SessionRecord>).id !== id ||
    typeof startedAt !== "string" ||
    !Number.isFinite(Date.parse(startedAt)) ||
    typeof recordedAt !== "string" ||
    !Number.isFinite(Date.parse(recordedAt)) ||
    (status !== "in-progress" && status !== "completed") ||
    (sourceSessionId !== undefined && (typeof sourceSessionId !== "string" || !SESSION_ID.test(sourceSessionId))) ||
    !Array.isArray(questions) ||
    questions.length === 0 ||
    !questions.every(isSessionAnswer) ||
    new Set(questions.map(questionKey)).size !== questions.length ||
    (status === "in-progress" && (
      currentIndex === undefined || !Number.isInteger(currentIndex) ||
      currentIndex < 0 || currentIndex >= questions.length
    )) ||
    typeof scope !== "object" || scope === null ||
    (scope.sources !== null && (!Array.isArray(scope.sources) || !scope.sources.every(source => typeof source === "string"))) ||
    (scope.order !== "sequential" && scope.order !== "random") ||
    (!Array.isArray(scope.targets) ||
      scope.targets.length < 1 || scope.targets.length > ALL_PRACTICE_TARGETS.length ||
      new Set(scope.targets).size !== scope.targets.length ||
      !scope.targets.every(isPracticeTarget)) ||
    typeof result !== "object" || result === null
  ) return false;

  const { correct, incorrect, unanswered, excluded, accuracy } = result;
  const counts = [correct, incorrect, unanswered, excluded];
  return counts.every(count => Number.isSafeInteger(count) && count >= 0) &&
    counts.reduce((sum, count) => sum + count, 0) === questions.length &&
    (accuracy === null || (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100));
}

function isSessionAnswer(value: unknown): value is SessionRecord["questions"][number] {
  if (!isQuestionReference(value)) return false;
  const { selected, grade, unknown } = value as Partial<SessionRecord["questions"][number]>;
  return Array.isArray(selected) && selected.every(item => typeof item === "string") &&
    typeof unknown === "boolean" &&
    (grade === null || grade === "correct" || grade === "incorrect" || grade === "excluded");
}

export function sessionAccuracy(correct: number, incorrect: number, excluded: number): number | null {
  const total = correct + incorrect + excluded;
  return total ? (correct + excluded) / total * 100 : null;
}

function normalizeLegacyScope(value: unknown): void {
  if (typeof value !== "object" || value === null || !("scope" in value)) return;
  const scope = value.scope;
  if (typeof scope !== "object" || scope === null || !("targets" in scope) || !Array.isArray(scope.targets)) return;
  scope.targets = scope.targets.map((target: unknown) => target === "correct" ? "good" : target === "incorrect" ? "wrong" : target);
}
