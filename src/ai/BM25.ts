export type SearchHit = { id: string; score: number };

export class BM25 {
  private averageLength: number;
  private postings = new Map<string, { id: string; count: number; length: number }[]>();

  constructor(documents: ReadonlyMap<string, readonly string[]>) {
    this.averageLength = [...documents.values()].reduce((sum, words) => sum + words.length, 0) / Math.max(1, documents.size) || 1;
    this.size = documents.size;
    for (const [id, words] of documents) {
      const counts = new Map<string, number>();
      for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
      for (const [word, count] of counts) {
        const posting = this.postings.get(word) ?? [];
        posting.push({ id, count, length: words.length });
        this.postings.set(word, posting);
      }
    }
  }

  private size: number;

  frequency(term: string): number { return this.postings.get(term)?.length ?? 0; }

  search(words: Iterable<string>): Map<string, number> {
    const results = new Map<string, number>();
    const k1 = 1.2;
    const b = 0.65;
    for (const word of new Set(words)) {
      const matches = this.postings.get(word);
      if (!matches) continue;
      const idf = Math.log1p((this.size - matches.length + 0.5) / (matches.length + 0.5));
      for (const { id, count, length } of matches) {
        const score = idf * count * (k1 + 1) / (count + k1 * (1 - b + b * length / this.averageLength));
        results.set(id, (results.get(id) ?? 0) + score);
      }
    }
    return results;
  }
}

export function rank<T extends SearchHit>(scores: T[]): T[] {
  return scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function fuseRanks(keyword: readonly SearchHit[], vector: readonly SearchHit[]): SearchHit[] {
  const scores = new Map<string, number>();
  for (const ranking of [keyword, vector]) {
    ranking.forEach(({ id }, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1)));
  }
  return rank([...scores].map(([id, score]) => ({ id, score })));
}
