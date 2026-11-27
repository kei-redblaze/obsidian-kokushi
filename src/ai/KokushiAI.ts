import { App, TFile } from "obsidian";
import { DATA_FOLDER } from "../constants";
import { Question } from "../types";
import { questionKey } from "../services/QuestionIdentity";
import { ensureFolder } from "../services/VaultFolder";
import { EmbeddingClient, EmbeddingModel } from "./EmbeddingClient";
import { MODEL_REVISION } from "./model";
import { EMBEDDING_BATCH, SubjectClassifier } from "./SubjectClassifier";
import { SUBJECT_IDS, SUBJECT_REVISION } from "./subjects";
import { classificationInput, noteQuery } from "./questionInput";
import { isSearchMode, readSearchPreferences, SearchMode, SearchPreferences } from "./searchPreferences";
import { keywordSubjects, SubjectKeywordHit } from "./keywordSearch";
import { fuseRanks, SearchHit } from "./BM25";
import { NoteSearch } from "./NoteSearch";

const CLASSIFICATIONS = `${DATA_FOLDER}/classifications.json`;
const INPUT_REVISION = 1;
const KEYWORD_SECOND_RATIO = 0.72;

type Entry = { signature: string; subjects: string[] };
type Classifications = {
  schema: 3;
  model: string;
  definition: string;
  input: number;
  mode: SearchMode;
  questions: Record<string, Entry>;
};

export class KokushiAI {
  private classifications?: Classifications;
  private outdated = false;
  private classifier: SubjectClassifier;
  private notes: NoteSearch;
  private settings = readSearchPreferences(null);
  private running = false;
  private closed = false;
  private revision = 0;

  constructor(private app: App, private model: EmbeddingModel = new EmbeddingClient()) {
    this.classifier = new SubjectClassifier(model);
    this.notes = new NoteSearch(app, model);
  }

  get isReady(): boolean { return this.model.isReady; }
  get subjects(): readonly string[] { return this.classifications ? SUBJECT_IDS : []; }
  get needsReclassification(): boolean {
    return this.outdated || !!this.classifications && this.classifications.mode !== this.effectiveMode(this.settings.classificationMode);
  }
  get backend() { return this.model.backend; }

  configure(settings: SearchPreferences): void {
    this.settings = settings;
    this.model.useWebGPU?.(settings.useWebGPU);
  }

  onBackendChange(listener: () => void): () => void {
    return this.model.onBackendChange?.(listener) ?? (() => {});
  }

  async removeModel(): Promise<void> {
    if (this.running) throw new Error("Classification is running");
    this.classifier.clear();
    this.notes.clear();
    await this.model.remove?.();
  }

  private effectiveMode(mode: SearchMode): SearchMode { return this.isReady ? mode : "keyword"; }

  newQuestionKeys(questions: readonly Question[]): string[] {
    const stored = this.classifications?.questions;
    return questions.map(questionKey).filter(key => !stored?.[key]);
  }

  prepare(progress: (completed: number, total: number) => void): Promise<void> {
    return this.model.prepare(progress);
  }

  close(): void {
    this.closed = true;
    this.model.close();
    this.classifier.clear();
    this.notes.clear();
  }

  async loadClassifications(): Promise<void> {
    const revision = this.revision;
    const file = this.app.vault.getAbstractFileByPath(CLASSIFICATIONS);
    let result: Classifications | undefined;
    if (file instanceof TFile) {
      try {
        result = parseClassifications(await this.app.vault.read(file));
      } catch (error) {
        console.warn("[Kokushi] Could not load classifications", error);
      }
    }
    if (!this.closed && this.revision === revision) {
      this.classifications = result;
      this.outdated = file instanceof TFile && !result;
    }
  }

  subjectsOf(question: Question): readonly string[] {
    const item = this.classifications?.questions[questionKey(question)];
    return item?.signature === signature(classificationInput(question)) ? item.subjects : [];
  }

  async classify(
    questions: readonly Question[],
    progress: (completed: number, total: number) => void,
  ): Promise<void> {
    if (this.closed || this.running) throw new Error("Classification unavailable");
    this.running = true;
    try {
      const mode = this.effectiveMode(this.settings.classificationMode);
      const previous = this.classifications?.mode === mode ? this.classifications : undefined;
      const entries: Record<string, Entry> = {};
      const changed = questions.flatMap(question => {
        const key = questionKey(question);
        const input = classificationInput(question);
        const fingerprint = signature(input);
        const existing = previous?.questions[key];
        if (existing?.signature !== fingerprint) return [{ input, key, fingerprint }];
        entries[key] = existing;
        return [];
      });
      progress(0, changed.length);
      for (let start = 0; start < changed.length; start += EMBEDDING_BATCH) {
        const batch = changed.slice(start, start + EMBEDDING_BATCH);
        const vector = mode !== "keyword" ? await this.classifier.classify(batch.map(({ input }) => input.text)) : [];
        batch.forEach(({ input, key, fingerprint }, index) => {
          const keyword = mode !== "vector" ? keywordSubjects(input) : [];
          entries[key] = { signature: fingerprint, subjects: selectSubjects(mode, keyword, vector[index] ?? []) };
        });
        if (mode === "keyword" && (start + EMBEDDING_BATCH) % 40 === 0) {
          await new Promise(resolve => window.setTimeout(resolve, 0));
        }
        if (this.closed) return;
        progress(start + batch.length, changed.length);
      }
      if (!changed.length && previous && Object.keys(entries).length === Object.keys(previous.questions).length) return;

      const next: Classifications = { schema: 3, model: mode === "keyword" ? "" : MODEL_REVISION, definition: SUBJECT_REVISION, input: INPUT_REVISION, mode, questions: entries };
      const content = JSON.stringify(next, null, 2) + "\n";
      await ensureFolder(this.app.vault, DATA_FOLDER);
      if (this.closed) return;
      const file = this.app.vault.getAbstractFileByPath(CLASSIFICATIONS);
      if (file instanceof TFile) await this.app.vault.process(file, () => content);
      else if (!file) await this.app.vault.create(CLASSIFICATIONS, content);
      else throw new Error("Classification location is not a file");
      this.revision++;
      this.classifications = next;
      this.outdated = false;
    } finally {
      this.running = false;
    }
  }

  suggestNotes(question: Question, exclude: readonly string[]): Promise<string[]> {
    return this.notes.search(noteQuery(question), exclude, this.effectiveMode(this.settings.noteMode), this.settings.noteThreshold);
  }
}

function parseClassifications(raw: string): Classifications | undefined {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== 3 ||
      !("mode" in value) || !isSearchMode(value.mode) ||
      !("input" in value) || value.input !== INPUT_REVISION ||
      !("model" in value) || value.model !== (value.mode === "keyword" ? "" : MODEL_REVISION) ||
      !("definition" in value) || value.definition !== SUBJECT_REVISION ||
      !("questions" in value) || typeof value.questions !== "object" || !value.questions || Array.isArray(value.questions)) return;
  const allowed = new Set(SUBJECT_IDS);
  const entries = Object.entries(value.questions).flatMap(([key, entry]: [string, unknown]): [string, Entry][] => {
    if (!key.startsWith("[") || !entry || typeof entry !== "object" || !("signature" in entry) || typeof entry.signature !== "string" ||
        !("subjects" in entry) || !Array.isArray(entry.subjects)) return [];
    return [[key, { signature: entry.signature, subjects: [...new Set(
      entry.subjects.filter((id: unknown): id is string => typeof id === "string" && allowed.has(id))
    )].slice(0, 2) }]];
  });
  return { schema: 3, model: value.mode === "keyword" ? "" : MODEL_REVISION, mode: value.mode, definition: SUBJECT_REVISION, input: INPUT_REVISION, questions: Object.fromEntries(entries) };
}

function signature({ final, choices, context }: ReturnType<typeof classificationInput>): string {
  const content = JSON.stringify([final, choices, context]);
  let hash = 2166136261;
  for (const character of content) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}


function selectSubjects(mode: SearchMode, keyword: SubjectKeywordHit[], vector: SearchHit[]): string[] {
  if (mode === "vector") return vector.map(({ id }) => id);
  const ranking = mode === "hybrid" ? fuseRanks(keyword, vector) : keyword;
  const [first, second] = ranking;
  if (!first) return [];
  if (!second) return [first.id];

  const primaryKeyword = keyword.find(hit => hit.id === first.id);
  const secondaryKeyword = keyword.find(hit => hit.id === second.id);
  const independent = secondaryKeyword && secondaryKeyword.evidence.some(term => !primaryKeyword?.evidence.includes(term));
  const closeKeyword = secondaryKeyword && (!primaryKeyword || secondaryKeyword.score >= primaryKeyword.score * KEYWORD_SECOND_RATIO);
  const closeVector = vector.length === 2 && vector.every(hit => hit.id === first.id || hit.id === second.id);
  // Consensus from both signals should not promote a single weak second match.
  const closeHybrid = mode !== "hybrid" || second.score >= first.score * 0.92;
  return closeHybrid && ((independent && closeKeyword) || closeVector) ? [first.id, second.id] : [first.id];
}
