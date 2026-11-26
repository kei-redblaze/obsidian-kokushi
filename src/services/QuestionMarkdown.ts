import { Question, QuestionOption } from "../types";

const SECTION_NAMES = ["Question", "Options", "Answer", "Annotation"] as const;
type SectionName = typeof SECTION_NAMES[number];
const OPTION_LINE = /^\s*(?:[-*]\s+)?([a-z])[.．]\s+(\S.*)$/;

export function parseQuestionMarkdown(markdown: string): Pick<Question, "stem" | "annotation" | "options" | "type" | "answer" | "excluded" | "requiredChoices"> {
  const sections = readSections(markdown);
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

function readSections(markdown: string): Map<SectionName, string[]> {
  const sections = new Map<SectionName, string[]>();
  let current: string[] | undefined;
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      current?.push(line);
      if (marker?.[1]?.[0] === fence[0] && marker[1].length >= fence.length && !marker[2]?.trim()) {
        fence = undefined;
      }
      continue;
    }
    if (marker?.[1]) {
      fence = marker[1];
      current?.push(line);
      continue;
    }
    const heading = /^ {0,3}#{1,2}[ \t]+(.+?)\s*$/.exec(line);
    if (heading) {
      const section = SECTION_NAMES.find(name => line.trim() === `## ${name}`);
      current = undefined;
      if (section) {
        if (sections.has(section)) throw new Error(`## ${section} が重複しています`);
        current = [];
        sections.set(section, current);
      }
    } else {
      current?.push(line);
    }
  }
  return sections;
}
