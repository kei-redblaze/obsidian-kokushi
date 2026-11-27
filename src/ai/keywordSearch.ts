import { BM25, rank, SearchHit } from "./BM25";
import { SUBJECTS } from "./subjects";
import { plain } from "./questionInput";

const generic = new Set("患者 病態 疾患 所見 症状 治療 検査 診断 予防 管理 説明 評価 急性 慢性 発熱 疼痛 病歴 問題 正しい 対応 異常 合併症 既往歴 患者の教育 意識障害 選択肢 次 回".split(" "));
const words = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "word" }) : undefined;
const aliases: Record<string, string> = {
  心筋梗塞症: "心筋梗塞", 慢性閉塞性肺疾患: "COPD", 一過性脳虚血発作: "TIA",
  播種性血管内凝固: "DIC", 心電図検査: "心電図", 骨髄異形成症候群: "MDS",
  全身性エリテマトーデス: "SLE", 慢性腎臓病: "CKD", 急性腎障害: "AKI",
  関節リウマチ: "RA", "抗アセチルコリン受容体抗体": "抗AChR抗体",
};

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replaceAll("剝", "剥").replaceAll("囊", "嚢").replaceAll("靭", "靱");
}

const concepts = new Map<string, string>();
for (const { name, terms } of SUBJECTS) {
  for (const item of [name, ...terms]) concepts.set(normalize(item), normalize(aliases[item] ?? item));
}
for (const [alias, term] of Object.entries(aliases)) {
  concepts.set(normalize(alias), normalize(term));
  concepts.set(normalize(term), normalize(term));
}
const compactConcepts = [...concepts].map(([term, id]) => [
  term,
  id,
  /^[a-z0-9-]+$/.test(term) ? new RegExp(`(?:^|[^a-z0-9])${term}(?![a-z0-9])`, "u") : undefined,
] as const);

function conceptTerms(text: string): Set<string> {
  const normalized = normalize(text);
  const compact = normalized.replace(/\s+/g, "");
  const matches = compactConcepts.filter(([term, , boundary]) =>
    !generic.has(term) && (boundary ? boundary.test(normalized) : compact.includes(term)));
  // Nested headwords (e.g. 腎炎 within 糸球体腎炎) count as one match.
  return new Set(matches.filter(([term]) => !matches.some(([other]) => other.length > term.length && other.includes(term)))
    .map(([, id]) => id));
}

function tokenize(text: string): string[] {
  const normalized = normalize(text);
  const parts = words ? [...words.segment(normalized)].filter(word => word.isWordLike).map(word => word.segment)
    : normalized.match(/[一-龯ぁ-んァ-ン]+|[a-z0-9]+/gu) ?? [];
  return [...parts.filter(word => word.length > 1 && !generic.has(word) && /[a-z一-龯ぁ-んァ-ン]/u.test(word)),
    ...conceptTerms(normalized)];
}

const subjectDocuments = new Map(SUBJECTS.map(subject => [
  subject.id, new Set([subject.name, ...subject.terms].map(term => concepts.get(normalize(term)) ?? normalize(term))),
]));
const subjectIndex = new BM25(new Map([...subjectDocuments].map(([id, terms]) => [id, [...terms]])));
export type SubjectKeywordHit = SearchHit & { evidence: readonly string[] };

export function keywordSubjects(input: { final: string; context: string; choices: string[] }): SubjectKeywordHit[] {
  const final = conceptTerms(input.final);
  const context = conceptTerms(input.context);
  const body = new Set([...final, ...context]);
  const choices = input.choices.map(conceptTerms);
  const allChoices = new Set(choices.flatMap(terms => [...terms]));
  const salient = (term: string): boolean => subjectIndex.frequency(term) <= 3;
  const scores = subjectIndex.search(body);
  const finalScores = subjectIndex.search(final);
  const choiceScores = subjectIndex.search(allChoices);
  const hits = [...subjectDocuments].flatMap(([id, vocabulary]) => {
    const matched = [...body].filter(term => vocabulary.has(term));
    const supportingOptions = choices.filter(terms => [...terms].some(term => vocabulary.has(term) && salient(term))).length;
    const optionConcepts = [...allChoices].filter(term => vocabulary.has(term) && salient(term));
    if (!(matched.some(salient) || matched.length >= 2 || (supportingOptions >= 2 && optionConcepts.length >= 2))) return [];
    return [{ id, evidence: [...new Set([...matched, ...optionConcepts])], score: (scores.get(id) ?? 0) + 0.6 * (finalScores.get(id) ?? 0) + 0.35 * (choiceScores.get(id) ?? 0) }];
  });
  return rank(hits);
}

export type KeywordNote = { title: string; headingTerms: Set<string>; sections: Set<string>[]; words: string[] };

export function keywordNote(title: string, markdown: string): KeywordNote {
  const headings = [...markdown.matchAll(/^ {0,3}#{1,6}\s+(.+)$/gm)].map(match => match[1]);
  const body = plain(markdown);
  const sections = markdown.split(/^ {0,3}#{1,6}\s+.+$/gm).map(section => conceptTerms(plain(section)));
  const headingTerms = conceptTerms([title, ...headings].join("\n"));
  const headingWords = tokenize([title, ...headings].join("\n"));
  return { title: normalize(title), headingTerms, sections, words: [...tokenize(body), ...headingWords, ...headingWords] };
}

export function keywordNotes(notes: ReadonlyMap<string, KeywordNote>, index: BM25, text: string, excluded: ReadonlySet<string>): SearchHit[] {
  const query = normalize(text);
  const { size } = notes;
  const terms = [...conceptTerms(text)].filter(term => index.frequency(term) <= Math.max(1, Math.ceil(size * 0.35)));
  const scores = index.search(tokenize(text));
  return rank([...scores].flatMap(([id, score]) => {
    const note = notes.get(id);
    if (!note || excluded.has(id)) return [];
    const heading = terms.some(term => note.headingTerms.has(term));
    const multi = note.sections.some(section => terms.filter(term => section.has(term)).length >= 2);
    const exactTitle = note.title.length >= 4 && !generic.has(note.title) && query.includes(note.title);
    return heading || multi || exactTitle ? [{ id, score }] : [];
  }));
}
