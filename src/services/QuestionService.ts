import { t } from "../i18n";
import { App, Notice, TFile } from "obsidian";
import { Question } from "../types";
import { PATHS } from "../constants";
import { isQuestionNumber, questionKey } from "./QuestionIdentity";
import { resolveQuestionAsset } from "./QuestionAssets";
import { parseQuestionFile } from "./QuestionMarkdown";

export interface QuestionIssue {
  path: string;
  id?: string;
  reason: string;
}

export class QuestionService {
  private reportedIssues = "";

  constructor(private app: App) {}

  async getQuestions(): Promise<Question[]> {
    const { questions, issues } = await this.scan(false);
    this.reportIssues(issues);
    return questions;
  }

  async checkFormat(): Promise<QuestionIssue[]> {
    return (await this.scan(true)).issues;
  }

  private async scan(checkImages: boolean): Promise<{ questions: Question[]; issues: QuestionIssue[] }> {
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(PATHS.questions + "/"));
    const entries: Question[] = [];
    const rejected = new Set<string>();
    const issues: QuestionIssue[] = [];
    const occurrences = new Map<string, Question[]>();

    for (const file of files) {
      try {
        const { questions, issues: fileIssues } = this.readFile(file, await this.app.vault.cachedRead(file));
        if (fileIssues.length) rejected.add(file.path);
        issues.push(...fileIssues);
        for (const question of questions) {
          entries.push(question);
          const key = questionKey(question);
          const matches = occurrences.get(key) ?? [];
          matches.push(question);
          occurrences.set(key, matches);
          if (checkImages) issues.push(...this.checkImages(question));
        }
      } catch (error) {
        issues.push({ path: file.path, reason: error instanceof Error ? error.message : t("問題を読み込めませんでした") });
      }
    }
    for (const matches of occurrences.values()) {
      if (matches.length < 2) continue;
      for (const { path, id } of matches) {
        rejected.add(path);
        issues.push({ path, id, reason: t("同じ出典に同じ問題番号が複数あります") });
      }
    }
    const questions = entries.filter(question => !rejected.has(question.path));
    return {
      questions: questions.sort((a, b) =>
        a.source.localeCompare(b.source, "ja", { numeric: true }) ||
        (a.sequence?.ids[0] ?? a.id).localeCompare(b.sequence?.ids[0] ?? b.id, "ja", { numeric: true }) ||
        (a.sequence?.index ?? 0) - (b.sequence?.index ?? 0)),
      issues,
    };
  }

  async reload(question: Question): Promise<Question> {
    const questions = await this.reloadFile(question.path);
    const updated = questions.find(item => questionKey(item) === questionKey(question));
    if (!updated) throw new Error(t("問題番号が見つかりません"));
    return updated;
  }

  async reloadFile(path: string): Promise<Question[]> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(t("問題Markdownが見つかりません"));
    const { questions, issues } = this.readFile(file, await this.app.vault.read(file));
    const issue = issues[0];
    if (issue) throw new Error([issue.id, issue.reason].filter(Boolean).join(" — "));
    return questions;
  }

  private readFile(file: TFile, markdown: string): { questions: Question[]; issues: QuestionIssue[] } {
    const [source, ...relative] = file.path.slice(PATHS.questions.length + 1).split("/");
    if (!source || !relative.length) throw new Error(t("問題は出典フォルダー内に置いてください"));
    if (!isQuestionNumber(file.basename) || source.includes("\\")) throw new Error(t("問題番号または出典名が不正です"));
    const result = parseQuestionFile(markdown, file.basename);
    return {
      questions: result.questions.map(question => ({ ...question, source, path: file.path })),
      issues: result.issues.map(issue => ({ ...issue, path: file.path })),
    };
  }

  private checkImages(question: Question): QuestionIssue[] {
    const markdown = [question.stem, question.annotation, ...question.options.map(option => option.markdown)].join("\n")
      .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, "");
    const references = new Map([...markdown.matchAll(/^\s*\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)]
      .map(match => [match[1]?.toLowerCase(), match[2] ?? match[3]]));
    const links = new Set<string>();
    for (const match of markdown.matchAll(/!\[\[([^\]|#]+)(?:[^\]]*)\]\]|!\[([^\]]*)\]\(\s*(?:<([^>]+)>|((?:[^\s()]+|\([^()]*\))+))|!\[([^\]]+)\](?:\[([^\]]*)\])?/g)) {
      const value = match[1] ?? match[3] ?? match[4] ?? references.get((match[6] || match[5])?.toLowerCase());
      if (value) links.add(value);
    }
    const issues: QuestionIssue[] = [];
    for (const link of links) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue;
      if (!resolveQuestionAsset(this.app, link, question.path)) {
        issues.push({ path: question.path, id: question.id, reason: t("画像が見つかりません（{0}）", link) });
      }
    }
    return issues;
  }

  private reportIssues(issues: QuestionIssue[]): void {
    const lines = issues.map(({ path, id, reason }) => [path, id, reason].filter(Boolean).join(" — "));
    const report = lines.join("\n");
    if (report === this.reportedIssues) return;
    this.reportedIssues = report;
    if (!issues.length) return;
    console.warn(t("[Kokushi] 問題セットの読み込みエラー\n") + report);
    const summary = lines.slice(0, 3).join("\n");
    const remaining = issues.length > 3 ? t("\nほか{0}件。全件は開発者コンソールを参照してください。", issues.length - 3) : "";
    new Notice(t("問題セットの書式を確認してください（{0}件）\n{1}{2}", issues.length, summary, remaining), 10000);
  }
}
