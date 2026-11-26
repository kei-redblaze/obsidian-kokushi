import { App, TFile } from "obsidian";
import { DATA_FOLDER, PATHS } from "../constants";
import { Question } from "../types";
import { questionKey } from "../services/QuestionIdentity";
import { ensureFolder } from "../services/VaultFolder";
import { EmbeddingClient, EmbeddingModel } from "./EmbeddingClient";
import { MODEL_REVISION } from "./model";
import { dot, EMBEDDING_BATCH, SubjectClassifier } from "./SubjectClassifier";
import { SUBJECT_IDS, SUBJECT_REVISION } from "./subjects";

const CLASSIFICATIONS = `${DATA_FOLDER}/classifications.json`;
const NOTE_THRESHOLD = 0.76;
const EMPTY: Classifications = { schema: 2, model: MODEL_REVISION, definition: SUBJECT_REVISION, questions: {} };

type Entry = { signature: string; subjects: string[] };
type Classifications = { schema: 2; model: string; definition: string; questions: Record<string, Entry> };
type NoteVector = { version: string; chunks: Float32Array[] };

export class KokushiAI {
  private classifications?: Classifications;
  private outdated = false;
  private classifier: SubjectClassifier;
  private notes = new Map<string, NoteVector>();
  private indexing?: Promise<void>;
  private running = false;
  private closed = false;
  private revision = 0;

  constructor(private app: App, private model: EmbeddingModel = new EmbeddingClient()) {
    this.classifier = new SubjectClassifier(model);
  }

  get isReady(): boolean { return this.model.isReady; }
  get subjects(): readonly string[] { return this.classifications ? SUBJECT_IDS : []; }
  get needsReclassification(): boolean { return this.outdated; }

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
    return item?.signature === signature(question) ? item.subjects : [];
  }

  async classify(
    questions: readonly Question[],
    progress: (completed: number, total: number) => void,
  ): Promise<void> {
    if (this.closed || this.running) throw new Error("Classification unavailable");
    this.running = true;
    try {
      const entries: Record<string, Entry> = {};
      const changed = questions.flatMap(question => {
        const key = questionKey(question);
        const fingerprint = signature(question);
        const existing = this.classifications?.questions[key];
        if (existing?.signature !== fingerprint) return [{ question, key, fingerprint }];
        entries[key] = existing;
        return [];
      });
      progress(0, changed.length);
      for (let start = 0; start < changed.length; start += EMBEDDING_BATCH) {
        const batch = changed.slice(start, start + EMBEDDING_BATCH);
        const results = await this.classifier.classify(batch.map(item => questionText(item.question)));
        batch.forEach(({ key, fingerprint }, index) => {
          entries[key] = { signature: fingerprint, subjects: results[index] };
        });
        progress(start + batch.length, changed.length);
      }
      if (!changed.length && this.classifications && Object.keys(entries).length === Object.keys(this.classifications.questions).length) return;

      const next = { ...EMPTY, questions: entries };
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

  async suggestNotes(question: Question, exclude: readonly string[]): Promise<string[]> {
    if (!this.model.isReady) return [];
    await this.indexNotes();
    if (!this.notes.size) return [];
    const [query] = await this.model.encode([`query: ${questionText(question)}`]);
    if (!query) return [];
    const excluded = new Set(exclude);
    const scores = [...this.notes.entries()].flatMap(([id, note]) => {
      if (excluded.has(id) || !note.chunks.length) return [];
      return [{ id, score: Math.max(...note.chunks.map(chunk => dot(chunk, query))) }];
    });
    return scores.filter(({ score }) => score >= NOTE_THRESHOLD)
      .sort((a, b) => b.score - a.score).map(({ id }) => id);
  }

  private async indexNotes(): Promise<void> {
    if (!this.indexing) {
      this.indexing = this.updateNoteIndex().finally(() => { this.indexing = undefined; });
    }
    await this.indexing;
  }

  private async updateNoteIndex(): Promise<void> {
    const prefix = `${PATHS.notes}/`;
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(prefix));
    const paths = new Set(files.map(file => file.path));
    for (const path of this.notes.keys()) if (!paths.has(path)) this.notes.delete(path);
    for (const file of files) {
      const version = `${file.stat?.mtime}:${file.stat?.size}`;
      if (this.notes.get(file.path)?.version === version) continue;
      const text = plain(await this.app.vault.cachedRead(file));
      const chunks = text.match(/.{1,350}/gu) ?? [""];
      const vectors: Float32Array[] = [];
      for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH) {
        vectors.push(...await this.model.encode(chunks.slice(start, start + EMBEDDING_BATCH).map(chunk =>
          `passage: ${file.basename} ${chunk}`)));
      }
      this.notes.set(file.path, { version, chunks: vectors });
    }
  }
}

function parseClassifications(raw: string): Classifications | undefined {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== EMPTY.schema ||
      !("model" in value) || value.model !== MODEL_REVISION ||
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
  return { ...EMPTY, questions: Object.fromEntries(entries) };
}

function signature(question: Question): string {
  let hash = 2166136261;
  const content = JSON.stringify([question.stem, question.options.map(({ id, markdown }) => [id, markdown]), question.answer]);
  for (const character of content) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function questionText(question: Question): string {
  const correct = new Set(question.answer.flat());
  const answers = question.options.filter(option => correct.has(option.id)).map(option => plain(option.markdown)).join(" ");
  const choices = question.options.map(option => plain(option.markdown)).join(" ");
  return `${answers.slice(0, 170)} ${plain(question.stem).slice(0, 750)} ${choices.slice(0, 320)}`.trim();
}

function plain(text: string): string {
  return text.replace(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}
