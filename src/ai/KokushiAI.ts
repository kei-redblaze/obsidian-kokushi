import { App, TFile } from "obsidian";
import { DATA_FOLDER, PATHS } from "../constants";
import { Question } from "../types";
import { questionKey } from "../services/QuestionIdentity";
import { ensureFolder } from "../services/VaultFolder";
import { EmbeddingClient, EmbeddingModel } from "./EmbeddingClient";
import { MODEL_REVISION } from "./model";

const CLASSIFICATIONS = `${DATA_FOLDER}/classifications.json`;
const BATCH = 4;
const EMPTY: Classifications = { schema: 1, model: MODEL_REVISION, subjects: [], questions: {} };

type Entry = { signature: string; subjects: string[] };
type Classifications = { schema: 1; model: string; subjects: string[]; questions: Record<string, Entry> };
type NoteVector = { version: string; chunks: Float32Array[] };

export class KokushiAI {
  private classifications = EMPTY;
  private notes = new Map<string, NoteVector>();
  private indexing?: Promise<void>;
  private running = false;
  private revision = 0;

  constructor(private app: App, private model: EmbeddingModel = new EmbeddingClient()) {}

  get isReady(): boolean { return this.model.isReady; }
  get subjects(): readonly string[] { return this.classifications.subjects; }

  prepare(progress: (completed: number, total: number) => void): Promise<void> {
    return this.model.prepare(progress);
  }

  close(): void {
    this.model.close();
    this.notes.clear();
  }

  async loadClassifications(): Promise<void> {
    const revision = this.revision;
    const file = this.app.vault.getAbstractFileByPath(CLASSIFICATIONS);
    let result = EMPTY;
    if (file instanceof TFile) {
      try {
        result = parseClassifications(await this.app.vault.cachedRead(file));
      } catch (error) {
        console.warn("[Kokushi] Could not load classifications", error);
      }
    }
    if (this.revision === revision) this.classifications = result;
  }

  subjectsOf(question: Question): readonly string[] {
    const item = this.classifications.questions[questionKey(question)];
    return item?.signature === signature(question) ? item.subjects : [];
  }

  async classify(
    questions: Question[],
    subjects: string[],
    progress: (completed: number, total: number) => void,
  ): Promise<void> {
    if (this.running) throw new Error("Classification is running");
    this.running = true;
    try {
      const entries: [string, Entry][] = [];
      if (subjects.length && questions.length) {
        const labels: Float32Array[] = [];
        for (let start = 0; start < subjects.length; start += BATCH) {
          labels.push(...await this.model.encode(subjects.slice(start, start + BATCH).map(label => `query: ${label}`)));
        }
        for (let start = 0; start < questions.length; start += BATCH) {
          const batch = questions.slice(start, start + BATCH);
          const vectors = await this.model.encode(batch.map(question => `passage: ${questionText(question)}`));
          batch.forEach((question, i) => {
            const vector = vectors[i];
            if (!vector || labels.length !== subjects.length) throw new Error("Classification embeddings are incomplete");
            const matches = rank(labels.map((label, index) => ({ id: subjects[index], score: dot(label, vector) })), 0.82, 0.022, subjects.length);
            entries.push([questionKey(question), { signature: signature(question), subjects: matches }]);
          });
          progress(start + batch.length, questions.length);
        }
      }
      const next = { ...EMPTY, subjects: [...subjects], questions: Object.fromEntries(entries) };
      const content = JSON.stringify(next, null, 2) + "\n";
      await ensureFolder(this.app.vault, DATA_FOLDER);
      const file = this.app.vault.getAbstractFileByPath(CLASSIFICATIONS);
      if (file instanceof TFile) await this.app.vault.process(file, () => content);
      else if (!file) await this.app.vault.create(CLASSIFICATIONS, content);
      else throw new Error("Classification location is not a file");
      this.revision++;
      this.classifications = next;
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
    return rank(scores, 0.76, 0.05, 5);
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
      for (let start = 0; start < chunks.length; start += BATCH) {
        vectors.push(...await this.model.encode(chunks.slice(start, start + BATCH).map(chunk =>
          `passage: ${file.basename} ${chunk}`)));
      }
      this.notes.set(file.path, { version, chunks: vectors });
    }
  }
}

function parseClassifications(raw: string): Classifications {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== 1 ||
      !("model" in value) || value.model !== MODEL_REVISION || !("subjects" in value) ||
      !Array.isArray(value.subjects) || !value.subjects.every(item => typeof item === "string" && item.length > 0) ||
      !("questions" in value) || typeof value.questions !== "object" || !value.questions || Array.isArray(value.questions)) {
    throw new Error("Invalid classification data");
  }
  const subjects: string[] = [...new Set<string>(value.subjects)];
  const allowed = new Set(subjects);
  // Keys are serialized [source, id] tuples. Store only validated rows.
  const entries = Object.entries(value.questions).flatMap(([key, entry]: [string, unknown]): [string, Entry][] => {
    if (!key.startsWith("[") || !entry || typeof entry !== "object" || !("signature" in entry) || typeof entry.signature !== "string" ||
        !("subjects" in entry) || !Array.isArray(entry.subjects)) return [];
    return [[key, { signature: entry.signature, subjects: entry.subjects.filter((s: unknown): s is string => typeof s === "string" && allowed.has(s)) }]];
  });
  return { ...EMPTY, subjects, questions: Object.fromEntries(entries) };
}

function signature(question: Question): string {
  let hash = 2166136261;
  for (const character of questionText(question)) {
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

function dot(a: Float32Array, b: Float32Array): number {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += (a[i] ?? 0) * (b[i] ?? 0);
  return score;
}

function rank(scores: { id: string; score: number }[], threshold: number, margin: number, max: number): string[] {
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]?.score ?? 0;
  return scores.filter(item => item.score >= threshold && item.score >= best - margin).slice(0, max).map(item => item.id);
}
