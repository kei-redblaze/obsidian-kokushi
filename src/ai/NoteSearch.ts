import { App } from "obsidian";
import { PATHS } from "../constants";
import { BM25, fuseRanks, rank, SearchHit } from "./BM25";
import type { EmbeddingModel } from "./EmbeddingClient";
import { dot, EMBEDDING_BATCH } from "./SubjectClassifier";
import { KeywordNote, keywordNote, keywordNotes } from "./keywordSearch";
import { plain } from "./questionInput";
import type { SearchMode } from "./searchPreferences";

type NoteEntry = { version: string; keyword?: KeywordNote; vectors?: Float32Array[] };

export class NoteSearch {
  private entries = new Map<string, NoteEntry>();
  private index?: BM25;
  private generation = 0;
  private queue = Promise.resolve();

  constructor(private app: App, private model: EmbeddingModel) {}

  search(query: string, exclude: readonly string[], mode: SearchMode, threshold: number): Promise<string[]> {
    const generation = this.generation;
    const search = this.queue.then(async () => {
      if (generation !== this.generation || !query) return [];
      const excluded = new Set(exclude);
      const keyword = mode !== "vector" ? await this.lexical(query, excluded) : [];
      const vector = mode !== "keyword" ? await this.vector(query, excluded, threshold) : [];
      if (generation !== this.generation) return [];
      return (mode === "hybrid" ? fuseRanks(keyword, vector) : mode === "keyword" ? keyword : vector).map(hit => hit.id);
    });
    this.queue = search.then(() => {}, () => {});
    return search;
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
    this.index = undefined;
  }

  private async lexical(query: string, exclude: ReadonlySet<string>): Promise<SearchHit[]> {
    await this.update(true);
    const notes = new Map([...this.entries].flatMap(([id, entry]) => entry.keyword ? [[id, entry.keyword] as const] : []));
    this.index ??= new BM25(new Map([...notes].map(([id, note]) => [id, note.words])));
    return keywordNotes(notes, this.index, query, exclude);
  }

  private async vector(query: string, exclude: ReadonlySet<string>, threshold: number): Promise<SearchHit[]> {
    await this.update(false);
    if (!this.entries.size) return [];
    const [text] = await this.model.encode([`query: ${query}`]);
    if (!text) return [];
    return rank([...this.entries].flatMap(([id, note]) => {
      if (exclude.has(id) || !note.vectors?.length) return [];
      const score = note.vectors.reduce((best, chunk) => Math.max(best, dot(chunk, text)), -1);
      return score >= threshold ? [{ id, score }] : [];
    }));
  }

  private async update(keyword: boolean): Promise<void> {
    const generation = this.generation;
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${PATHS.notes}/`));
    const paths = new Set(files.map(file => file.path));
    for (const path of this.entries.keys()) {
      if (!paths.has(path)) {
        this.entries.delete(path);
        this.index = undefined;
      }
    }
    for (const file of files) {
      const version = `${file.stat?.mtime}:${file.stat?.size}`;
      const saved = this.entries.get(file.path);
      const entry = saved?.version === version ? saved : { version };
      if (keyword ? entry.keyword : entry.vectors) continue;
      const markdown = await this.app.vault.cachedRead(file);
      if (keyword) {
        entry.keyword = keywordNote(file.basename, markdown);
        this.index = undefined;
      } else {
        const chunks = plain(markdown).match(/.{1,350}/gu) ?? [""];
        const vectors: Float32Array[] = [];
        for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH) {
          vectors.push(...await this.model.encode(chunks.slice(start, start + EMBEDDING_BATCH).map(chunk =>
            `passage: ${file.basename} ${chunk}`)));
          if (generation !== this.generation) return;
        }
        entry.vectors = vectors;
      }
      if (generation !== this.generation) return;
      if (saved?.keyword && entry !== saved) this.index = undefined;
      this.entries.set(file.path, entry);
    }
  }
}
