
import {
  App,
  TFile,
} from "obsidian";

import { Attempt, PracticeTarget, QuestionReference } from "../types";
import { ATTEMPTS_FOLDER, PATHS } from "../constants";
import { isQuestionReference, questionKey } from "./QuestionIdentity";
import { ensureFolder } from "./VaultFolder";
import { attemptRating, isPracticeTarget } from "./PracticeTargets";

export class AttemptService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private app: App) {}

  async save(attempt: Attempt): Promise<void> {
    const task = this.queue.then(
      async () => {
        const path = PATHS.attempts;
        const line = JSON.stringify(attempt) + "\n";

        const existing =
          this.app.vault.getAbstractFileByPath(path);

        if (existing instanceof TFile) {
          await this.app.vault.append(existing, line);
          return;
        }

        if (existing !== null) {
          throw new Error(
            "履歴保存先がファイルではありません"
          );
        }

        // 初回のみ履歴ファイルを作成
        await ensureFolder(this.app.vault, ATTEMPTS_FOLDER);
        await this.app.vault.create(path, line);
      }
    );

    // 失敗後も次回の保存を実行可能にする
    this.queue = task.catch(() => {});

    return task;
  }

  async updateRating(sessionId: string, question: QuestionReference, rating: PracticeTarget): Promise<void> {
    const task = this.queue.then(async () => {
      const file = this.app.vault.getAbstractFileByPath(PATHS.attempts);
      if (!(file instanceof TFile)) throw new Error("解答履歴が見つかりません");
      const key = questionKey(question);
      await this.app.vault.process(file, text => {
        const lines = text.split(/(\r?\n)/);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          const line = lines[i];
          if (!line?.trim()) continue;
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          if (!isAttempt(value) || value.sessionId !== sessionId || questionKey(value) !== key) continue;
          lines[i] = JSON.stringify({ ...value, rating });
          return lines.join("");
        }
        throw new Error("この演習の解答が見つかりません");
      });
    });
    this.queue = task.catch(() => {});
    await task;
  }

  async getSessionRatings(sessionId: string): Promise<Map<string, PracticeTarget>> {
    const attempts = await this.getAttempts();
    return new Map(attempts.filter(attempt => attempt.sessionId === sessionId)
      .map(attempt => [questionKey(attempt), attemptRating(attempt)]));
  }

  async discardSession(sessionId: string): Promise<void> {
    const task = this.queue.then(async () => {
      const file = this.app.vault.getAbstractFileByPath(PATHS.attempts);
      if (file === null) return;
      if (!(file instanceof TFile)) throw new Error("解答履歴の保存先がファイルではありません");

      await this.app.vault.process(file, text => text.replace(/[^\n]+(?:\n|$)/g, line => {
        try {
          const value: unknown = JSON.parse(line);
          return typeof value === "object" && value !== null && "sessionId" in value &&
            value.sessionId === sessionId ? "" : line;
        } catch {
          return line;
        }
      }));
    });
    this.queue = task.catch(() => {});
    await task;
  }

  async getAttempts(): Promise<Attempt[]> {
    return (await this.readAttempts()).attempts;
  }

  async readAttempts(): Promise<{ attempts: Attempt[]; invalidLines: number }> {
    await this.queue;
    const file = this.app.vault.getAbstractFileByPath(PATHS.attempts);
    if (!(file instanceof TFile)) return { attempts: [], invalidLines: 0 };

    const content = await this.app.vault.cachedRead(file);
    const attempts: Attempt[] = [];
    let invalidLines = 0;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (isAttempt(value)) attempts.push(value);
        else invalidLines++;
      } catch {
        invalidLines++;
      }
    }
    return { attempts, invalidLines };
  }
}

function isAttempt(value: unknown): value is Attempt {
  if (!isQuestionReference(value)) return false;
  const { timestamp, selected, correct, rating } = value as Partial<Attempt>;
  return typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)) &&
    Array.isArray(selected) && selected.every(item => typeof item === "string") &&
    (correct === null || typeof correct === "boolean") &&
    (rating === undefined || isPracticeTarget(rating));
}
