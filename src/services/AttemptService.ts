
import {
  App,
  TFile,
} from "obsidian";

import { Attempt } from "../types";
import { ATTEMPTS_FOLDER, PATHS } from "../constants";
import { ensureFolder } from "./VaultFolder";

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

  async getAttempts(): Promise<Attempt[]> {
    const file =
      this.app.vault.getAbstractFileByPath(
        PATHS.attempts
      );

    if (!(file instanceof TFile)) {
      return [];
    }

    const content = await this.app.vault.read(file);

    return content
      .split("\n")
      .filter(line => line.trim() !== "")
      .map(line => JSON.parse(line) as Attempt);
  }
}
