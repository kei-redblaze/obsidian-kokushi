import type { EmbeddingModel } from "./EmbeddingClient";
import { SUBJECTS } from "./subjects";

const TERMS_PER_PROFILE = 8;
export const EMBEDDING_BATCH = 4;
const MIN_SUBJECT_SCORE = 0.85;
const MIN_SECOND_SUBJECT_SCORE = 0.872;
const SECOND_SUBJECT_MARGIN = 0.012;
const THIRD_SUBJECT_GAP = 0.0015;

type Profile = { id: string; name: Float32Array; groups: Float32Array[] };

export class SubjectClassifier {
  private profiles?: Profile[];

  constructor(private model: EmbeddingModel) {}

  async classify(texts: string[]): Promise<string[][]> {
    const profiles = this.profiles ??= await this.loadProfiles();
    const vectors = await this.model.encode(texts.map(text => `passage: ${text}`));
    if (vectors.length !== texts.length) throw new Error("Question embeddings are incomplete");
    return vectors.map(vector => {
      const scores = profiles.map(profile => ({ id: profile.id, score: subjectScore(profile, vector) }));
      const ranked = scores.sort((a, b) => b.score - a.score);
      const [best, second, third] = ranked;
      if (!best || best.score < MIN_SUBJECT_SCORE) return [];
      const distinctSecond = second && (!third || second.score - third.score >= THIRD_SUBJECT_GAP);
      return distinctSecond && second.score >= MIN_SECOND_SUBJECT_SCORE && best.score - second.score <= SECOND_SUBJECT_MARGIN
        ? [best.id, second.id] : [best.id];
    });
  }

  clear(): void {
    this.profiles = undefined;
  }

  private async loadProfiles(): Promise<Profile[]> {
    const profiles: Profile[] = [];
    for (const { id, name, terms } of SUBJECTS) {
      // Short profiles let every term contribute within the model's input limit.
      const texts = [`query: ${name}`];
      for (let start = 0; start < terms.length; start += TERMS_PER_PROFILE) {
        texts.push(`query: ${name} ${terms.slice(start, start + TERMS_PER_PROFILE).join("、")}`);
      }
      const vectors: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += EMBEDDING_BATCH) {
        vectors.push(...await this.model.encode(texts.slice(start, start + EMBEDDING_BATCH)));
      }
      const [label, ...groups] = vectors;
      if (!label || vectors.length !== texts.length) throw new Error("Subject embeddings are incomplete");
      profiles.push({ id, name: label, groups });
    }
    return profiles;
  }
}

function subjectScore(profile: Profile, question: Float32Array): number {
  const nearest = profile.groups.map(group => dot(group, question)).sort((a, b) => b - a).slice(0, 3);
  const mean = nearest.reduce((total, value) => total + value, 0) / nearest.length;
  // A few close profiles carry the subject's signal without letting one match dominate.
  const groupScore = 0.2 * nearest[0] + 0.8 * mean;
  return 0.1 * dot(profile.name, question) + 0.9 * groupScore;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += (a[i] ?? 0) * (b[i] ?? 0);
  return score;
}
