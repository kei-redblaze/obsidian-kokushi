import { TFile, TFolder, Vault } from "obsidian";
import { ATTEMPTS_FOLDER, PATHS, QUESTION_ID_PATTERN } from "../constants";
import { SessionRecord, SessionResult } from "../types";
import { ensureFolder } from "./VaultFolder";

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
  private activeDrafts = new Set<string>();

  constructor(private vault: Vault) {}

  claimDraft(id: string): boolean {
    if (this.activeDrafts.has(id)) return false;
    this.activeDrafts.add(id);
    return true;
  }

  releaseDraft(id: string): void {
    this.activeDrafts.delete(id);
  }

  save(session: SessionRecord): Promise<void> {
    if (!SESSION_ID.test(session.id)) throw new Error("演習履歴IDが不正です");

    const task = this.pending.then(async () => {
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

  async getSession(id: string): Promise<SessionRecord | null> {
    if (!SESSION_ID.test(id)) return null;
    await this.pending;
    const file = this.vault.getAbstractFileByPath(`${PATHS.sessions}/${id}.json`);
    return file instanceof TFile ? this.readSession(file) : null;
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
          status: record.status !== "in-progress" ? "completed"
            : this.activeDrafts.has(record.id) ? "active" : "interrupted",
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
    if (!isSessionRecord(value, file.basename)) throw new Error("演習履歴の形式が不正です");
    return value;
  }
}

function isSessionRecord(value: unknown, id: string): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const { schemaVersion, startedAt, recordedAt, questions, result, scope, status, currentIndex, sourceSessionId } =
    value as Partial<SessionRecord>;
  if (
    schemaVersion !== 1 ||
    (value as Partial<SessionRecord>).id !== id ||
    typeof startedAt !== "string" ||
    !Number.isFinite(Date.parse(startedAt)) ||
    typeof recordedAt !== "string" ||
    !Number.isFinite(Date.parse(recordedAt)) ||
    (status !== undefined && status !== "in-progress" && status !== "completed") ||
    (sourceSessionId !== undefined && (typeof sourceSessionId !== "string" || !SESSION_ID.test(sourceSessionId))) ||
    !Array.isArray(questions) ||
    questions.length === 0 ||
    !questions.every(isSessionAnswer) ||
    (status === "in-progress" && (
      currentIndex === undefined || !Number.isInteger(currentIndex) ||
      currentIndex < 0 || currentIndex >= questions.length
    )) ||
    typeof scope !== "object" || scope === null ||
    (scope.exams !== null && (!Array.isArray(scope.exams) || !scope.exams.every(exam => typeof exam === "string"))) ||
    (scope.order !== "sequential" && scope.order !== "random") ||
    (scope.target !== "all" && scope.target !== "unanswered" && scope.target !== "incorrect") ||
    typeof result !== "object" || result === null
  ) return false;

  const { correct, incorrect, unanswered, excluded, accuracy } = result;
  const counts = [correct, incorrect, unanswered, excluded];
  return counts.every(count => Number.isSafeInteger(count) && count >= 0) &&
    counts.reduce((sum, count) => sum + count, 0) === questions.length &&
    (accuracy === null || (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100));
}

function isSessionAnswer(value: unknown): value is SessionRecord["questions"][number] {
  if (typeof value !== "object" || value === null) return false;
  const { id, selected, grade, unknown } = value as Partial<SessionRecord["questions"][number]>;
  return typeof id === "string" && QUESTION_ID_PATTERN.test(id) &&
    Array.isArray(selected) && selected.every(item => typeof item === "string") &&
    typeof unknown === "boolean" &&
    (grade === null || grade === "correct" || grade === "incorrect" || grade === "excluded");
}
