
import {
  App,
  TFile,
  parseYaml,
} from "obsidian";

import { Question, QuestionType } from "../types";
import {
  PATHS,
  QUESTION_ID_PATTERN,
} from "../constants";

export class QuestionService {
  constructor(private app: App) {}

  async getQuestions(): Promise<Question[]> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter(file =>
        file.path.startsWith(
          PATHS.questions + "/"
        )
      );

    const questions: Question[] = [];

    for (const file of files) {
      if (!QUESTION_ID_PATTERN.test(file.basename)) {
        continue;
      }

      const yamlPath = file.path.replace(
        /\.md$/,
        ".yaml"
      );

      const yamlFile =
        this.app.vault.getAbstractFileByPath(yamlPath);

      if (!(yamlFile instanceof TFile)) {
        console.warn(
          `YAMLがありません: ${yamlPath}`
        );
        continue;
      }

      try {
        const markdown =
          await this.app.vault.cachedRead(file);

        const yamlText =
          await this.app.vault.cachedRead(yamlFile);

        const data: unknown = parseYaml(yamlText);

        if (!this.isValidMetadata(data)) {
          throw new Error("YAML形式が不正です");
        }

        if (data.id !== file.basename) {
          throw new Error("問題IDが一致しません");
        }

        questions.push({
          id: data.id,
          type: data.type,
          answer: data.answer,
          excluded: data.excluded === true,
          markdown,
          path: file.path,
        });
      } catch (error) {
        console.error(
          `問題の読み込み失敗: ${file.path}`,
          error
        );
      }
    }

    return questions.sort((a, b) =>
      this.compareIds(a.id, b.id)
    );
  }

  private isValidMetadata(
    value: unknown
  ): value is {
    id: string;
    type: QuestionType;
    answer: string[][];
    excluded?: boolean;
  } {
    if (
      typeof value !== "object" ||
      value === null
    ) return false;

    const data = value as Record<string, unknown>;

    if (
      typeof data.id !== "string" ||
      !QUESTION_ID_PATTERN.test(data.id)
    ) return false;

    if (
      data.type !== "single" &&
      data.type !== "multiple" &&
      data.type !== "numeric"
    ) return false;

    if (
      data.excluded !== undefined &&
      typeof data.excluded !== "boolean"
    ) return false;

    if (!Array.isArray(data.answer)) return false;

    const answers = data.answer;

    if (data.excluded !== true && answers.length === 0) {
      return false;
    }

    if (!answers.every(
      (set: unknown) =>
        Array.isArray(set) &&
        set.every(v => typeof v === "string")
    )) return false;

    if (data.type === "single") {
      return answers.every(set =>
        set.length === 1 &&
        /^[a-z]$/.test(set[0])
      );
    }

    if (data.type === "multiple") {
      const length = answers[0]?.length;

      return answers.every(set =>
        set.length >= 2 &&
        set.length === length &&
        new Set(set).size === set.length &&
        set.every(v => /^[a-z]$/.test(v))
      );
    }

    return answers.every(set =>
      set.length === 1 &&
      /^\d+$/.test(set[0])
    );
  }

  private compareIds(a: string, b: string): number {
    const matchA = a.match(QUESTION_ID_PATTERN);
    const matchB = b.match(QUESTION_ID_PATTERN);

    if (!matchA || !matchB) {
      return a.localeCompare(b);
    }

    return (
      Number(matchA[1]) - Number(matchB[1]) ||
      matchA[2].localeCompare(matchB[2]) ||
      Number(matchA[3]) - Number(matchB[3])
    );
  }
}
