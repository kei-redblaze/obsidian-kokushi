
import {
  App,
  TFile,
} from "obsidian";

import { parseDocument } from "yaml";
import { Question, QuestionType } from "../types";
import { PATHS } from "../constants";
import { isQuestionNumber, questionKey, readYamlQuestionNumber } from "./QuestionIdentity";

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
      if (!isQuestionNumber(file.basename)) {
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

        const yaml = parseDocument(yamlText);
        const data: unknown = yaml.toJS();

        if (yaml.errors.length || !this.isValidMetadata(data)) {
          throw new Error("YAML形式が不正です");
        }

        if (readYamlQuestionNumber(yaml.get("id", true)) !== file.basename) {
          throw new Error("問題IDが一致しません");
        }

        questions.push({
          id: file.basename,
          source: file.path.slice(PATHS.questions.length + 1).split("/").slice(0, -1)[0] ?? "",
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

    const byKey = new Map<string, Question>();
    const duplicate = new Set<string>();
    for (const question of questions) {
      const key = questionKey(question);
      if (duplicate.has(key)) continue;
      if (byKey.has(key)) {
        console.warn("[Kokushi] Duplicate question", byKey.get(key)?.path, question.path);
        byKey.delete(key);
        duplicate.add(key);
      } else {
        byKey.set(key, question);
      }
    }

    return [...byKey.values()].sort((a, b) =>
      a.source.localeCompare(b.source, "ja", { numeric: true }) ||
      a.id.localeCompare(b.id, "ja", { numeric: true })
    );
  }

  private isValidMetadata(
    value: unknown
  ): value is {
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
}
