import { Question, QuestionOption } from "../types";

import { isQuestionNumber } from "./QuestionIdentity";

const SECTION_NAMES = ["Question", "Options", "Answer", "Annotation"] as const;
type SectionName = typeof SECTION_NAMES[number];
const OPTION_LINE = /^\s*(?:[-*]\s+)?([a-z])[.．]\s+(\S.*)$/;

type QuestionContent = Pick<Question, "stem" | "annotation" | "options" | "type" | "answer" | "excluded" | "requiredChoices">;

export function parseQuestionMarkdown(markdown: string, depth = 2): QuestionContent {
  const sections = readSections(markdown.split(/\r?\n/), depth);
  const stem = sections.get("Question")?.join("\n").trim();
  if (!stem) throw new Error("## Question に問題文を記述してください");

  const annotation = sections.get("Annotation")?.join("\n").trim() ?? "";
  const answerSection = sections.get("Answer");
  if (!answerSection) throw new Error("## Answer 見出しがありません");

  const optionsSection = sections.get("Options");
  const options = optionsSection ? readOptions(optionsSection) : [];
  const answers = answerSection.join("\n").trim();
  if (!answers || answers === "採点除外") {
    return { stem, annotation, options, type: optionsSection ? "multiple" : "numeric", answer: [], excluded: true, requiredChoices: null };
  }

  const groups = answers.split(/\n(?:[^\S\n]*\n)+/);
  if (!optionsSection) {
    const values = groups.map(group => group.trim());
    if (!values.every(value => /^\d+$/.test(value))) {
      throw new Error("数値の正答は半角数字だけを1行に記述し、候補を空行で区切ってください");
    }
    return { stem, annotation, options, type: "numeric", answer: values.map(value => [value]), excluded: false, requiredChoices: 1 };
  }

  const optionIds = new Set(options.map(option => option.id));
  const answer = groups.map(group => {
    const ids = group.split("\n").map(line => {
      const id = line.match(OPTION_LINE)?.[1];
      if (!id) throw new Error("選択式の正答は「a. 選択肢の本文」の形式で記述してください");
      if (!optionIds.has(id)) throw new Error(`正答の記号「${id}」が ## Options にありません`);
      return id;
    });
    if (new Set(ids).size !== ids.length) throw new Error("同じ正答候補の中に重複する記号があります");
    return ids;
  });
  const sizes = new Set(answer.map(group => group.length));
  return {
    stem, annotation, options, type: sizes.size === 1 && sizes.has(1) ? "single" : "multiple", answer, excluded: false,
    requiredChoices: sizes.size === 1 ? answer[0]?.length ?? null : null,
  };
}

function readOptions(lines: string[]): QuestionOption[] {
  const options: QuestionOption[] = [];
  const ids = new Set<string>();
  let current: QuestionOption | undefined;
  for (const line of lines) {
    const option = line.match(OPTION_LINE);
    if (option?.[1] && option[2]) {
      const id = option[1];
      if (ids.has(id)) throw new Error(`## Options の記号「${id}」が重複しています`);
      ids.add(id);
      current = { id, markdown: option[2] };
      options.push(current);
    } else if (current) {
      current.markdown += "\n" + line;
    } else if (line.trim()) {
      throw new Error("## Options は「a. 選択肢の本文」の形式で始めてください");
    }
  }
  if (!options.length) throw new Error("## Options に選択肢がありません");
  return options.map(({ id, markdown }) => ({ id, markdown: markdown.trim() }));
}

export function parseQuestionFile(markdown: string, filenameId: string): {
  questions: (QuestionContent & Pick<Question, "id" | "sequence">)[];
  issues: { id: string; reason: string }[];
} {
  const lines = markdown.split(/\r?\n/);
  const headings = markdownHeadings(lines).filter(heading => heading.depth <= 2);
  const blocks = headings.flatMap((heading, index) => {
    if (heading.depth !== 2 || !/^小問(?:\s|$)/.test(heading.name)) return [];
    return [{ id: heading.name.slice("小問".length).trim(), start: heading.index + 1, end: headings[index + 1]?.index }];
  });
  if (!blocks.length) {
    try {
      return { questions: [{ id: filenameId, ...parseQuestionMarkdown(markdown) }], issues: [] };
    } catch (error) {
      return { questions: [], issues: [{ id: filenameId, reason: errorMessage(error) }] };
    }
  }

  const issues: { id: string; reason: string }[] = [];
  const commonIndex = headings.findIndex(heading => heading.depth === 2 && heading.name === "共通症例");
  const commonHeading = headings[commonIndex];
  const common = commonHeading ? lines.slice(commonHeading.index + 1, headings[commonIndex + 1]?.index).join("\n").trim() : "";
  if (headings.filter(heading => heading.depth === 2 && heading.name === "共通症例").length > 1) {
    issues.push({ id: "", reason: "## 共通症例 が重複しています" });
  }
  if (commonHeading && commonHeading.index >= blocks[0].start) {
    issues.push({ id: "", reason: "## 共通症例 は最初の小問より前に置いてください" });
  }
  if (blocks.length < 2) issues.push({ id: "", reason: "連問には2つ以上の小問が必要です" });
  if (headings.some(heading => heading.depth === 2 && SECTION_NAMES.some(name => name === heading.name))) {
    issues.push({ id: "", reason: "連問の Question、Options、Answer、Annotation は ### 見出しで記述してください" });
  }
  const ids = blocks.map(block => block.id);
  const seen = new Set<string>();
  const questions = blocks.flatMap(({ id, start, end }, index) => {
    try {
      if (!isQuestionNumber(id)) throw new Error("## 小問 の後に問題番号を記述してください");
      if (seen.has(id)) throw new Error("小問番号が同じファイルに重複しています");
      seen.add(id);
      const content = parseQuestionMarkdown(lines.slice(start, end).join("\n"), 3);
      const stem = common ? `${common}\n\n${content.stem}` : content.stem;
      return [{ ...content, id, stem, sequence: { index, ids } }];
    } catch (error) {
      issues.push({ id, reason: errorMessage(error).replace(/## /g, "### ") });
      return [];
    }
  });
  return { questions, issues };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "問題を読み込めませんでした";
}

function readSections(lines: string[], depth: number): Map<SectionName, string[]> {
  const result = new Map<SectionName, string[]>();
  const headings = markdownHeadings(lines).filter(heading => heading.depth <= depth);
  headings.forEach((heading, index) => {
    const section = heading.depth === depth ? SECTION_NAMES.find(name => name === heading.name) : undefined;
    if (!section) return;
    if (result.has(section)) throw new Error(`## ${section} が重複しています`);
    result.set(section, lines.slice(heading.index + 1, headings[index + 1]?.index));
  });
  return result;
}

function markdownHeadings(lines: string[]): { index: number; depth: number; name: string }[] {
  const headings: { index: number; depth: number; name: string }[] = [];
  let fence: string | undefined;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1]?.[0] === fence[0] && marker[1].length >= fence.length && !marker[2]?.trim()) fence = undefined;
      return;
    }
    if (marker?.[1]) {
      fence = marker[1];
      return;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
    if (heading?.[1] && heading[2]) headings.push({ index, depth: heading[1].length, name: heading[2] });
  });
  return headings;
}
