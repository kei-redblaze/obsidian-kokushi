import { App, Notice, TFile } from "obsidian";
import { Question } from "../types";
import { PATHS } from "../constants";
import { isQuestionNumber, questionKey } from "./QuestionIdentity";
import { parseQuestionMarkdown } from "./QuestionMarkdown";

export class QuestionService {
  private reportedIssues = "";

  constructor(private app: App) {}

  async getQuestions(): Promise<Question[]> {
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(PATHS.questions + "/"));
    const byKey = new Map<string, Question>();
    const seen = new Set<string>();
    const issues: string[] = [];

    for (const file of files) {
      try {
        const identity = this.getIdentity(file);
        const key = questionKey(identity);
        if (seen.has(key)) {
          byKey.delete(key);
          throw new Error("同じ出典に同じ問題番号が複数あります");
        }
        seen.add(key);
        const question = { ...identity, ...parseQuestionMarkdown(await this.app.vault.cachedRead(file)) };
        byKey.set(key, question);
      } catch (error) {
        issues.push(`${file.path} — ${error instanceof Error ? error.message : "問題を読み込めませんでした"}`);
      }
    }
    this.reportIssues(issues);
    return [...byKey.values()].sort((a, b) =>
      a.source.localeCompare(b.source, "ja", { numeric: true }) ||
      a.id.localeCompare(b.id, "ja", { numeric: true })
    );
  }

  async reload(question: Question): Promise<Question> {
    const file = this.app.vault.getAbstractFileByPath(question.path);
    if (!(file instanceof TFile)) throw new Error("問題Markdownが見つかりません");
    return { ...this.getIdentity(file), ...parseQuestionMarkdown(await this.app.vault.read(file)) };
  }

  private getIdentity(file: TFile): Pick<Question, "id" | "source" | "path"> {
    const [source, ...relative] = file.path.slice(PATHS.questions.length + 1).split("/");
    if (!source || !relative.length) throw new Error("問題は出典フォルダー内に置いてください");
    if (!isQuestionNumber(file.basename) || source.includes("\\")) throw new Error("問題番号または出典名が不正です");
    return { id: file.basename, source, path: file.path };
  }

  private reportIssues(issues: string[]): void {
    const report = issues.join("\n");
    if (report === this.reportedIssues) return;
    this.reportedIssues = report;
    if (!issues.length) return;
    console.warn("[Kokushi] 問題セットの読み込みエラー\n" + report);
    const summary = issues.slice(0, 3).join("\n");
    const remaining = issues.length > 3 ? `\nほか${issues.length - 3}件。全件は開発者コンソールを参照してください。` : "";
    new Notice(`問題セットの書式を確認してください（${issues.length}件）\n${summary}${remaining}`, 10000);
  }
}
