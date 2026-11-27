import type { Question } from "../types";

const sentences = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "sentence" }) : undefined;

export function plain(text: string): string {
  return text.replace(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]|!\[[^\]]*\](?=\s|$)/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function classificationInput(question: Question) {
  const lines = question.stem.replace(/\r\n/g, "\n").split("\n");
  const tableLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("|") || !/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i])) continue;
    if (i > 0 && lines[i - 1].includes("|")) tableLines.add(i - 1);
    for (let j = i; j < lines.length && lines[j].includes("|"); j++) tableLines.add(j);
  }
  let final = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (tableLines.has(i) || !isProse(line)) continue;
    let start = i;
    while (start > 0 && !tableLines.has(start - 1) && isProse(lines[start - 1]) &&
      !/[。！？!?][」』】）"']*$/.test(lines[start - 1].trim())) start--;
    const text = plain(lines.slice(start, i + 1).join(" "));
    const segments = sentences ? [...sentences.segment(text)].map(part => part.segment) : text.match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/gu) ?? [];
    final = segments.pop()?.trim() ?? text;
    lines.splice(start, i - start + 1, segments.join("").trim());
    break;
  }
  const context = plain(lines.join("\n"));
  const choices = question.options.map(option => plain(option.markdown));
  return { final, context, choices, text: [final, ...choices, context].filter(Boolean).join("\n") };
}

function isProse(line: string): boolean {
  const text = plain(line);
  return !!text && !/^\s*(?:\||[-*+]\s|\d+[.)]\s|<!--|<img\b|<table\b)/i.test(text);
}

export function noteQuery(question: Question): string {
  const correct = new Set(question.answer.flat());
  const answers = question.options.filter(option => correct.has(option.id)).map(option => plain(option.markdown)).join(" ");
  const choices = question.options.map(option => plain(option.markdown)).join(" ");
  return `${answers.slice(0, 170)} ${plain(question.stem).slice(0, 750)} ${choices.slice(0, 320)}`.trim();
}
