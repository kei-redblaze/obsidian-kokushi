export const SEARCH_MODES = ["vector", "keyword", "hybrid"] as const;
export type SearchMode = typeof SEARCH_MODES[number];

export const DEFAULT_NOTE_THRESHOLD = 0.90;

export interface SearchPreferences {
  classificationMode: SearchMode;
  noteMode: SearchMode;
  noteThreshold: number;
  useWebGPU: boolean;
}

export function isSearchMode(value: unknown): value is SearchMode {
  return value === "vector" || value === "keyword" || value === "hybrid";
}

export function isNoteThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function readSearchPreferences(value: Partial<SearchPreferences> | null): SearchPreferences {
  return {
    classificationMode: isSearchMode(value?.classificationMode) ? value.classificationMode : "keyword",
    noteMode: isSearchMode(value?.noteMode) ? value.noteMode : "keyword",
    noteThreshold: isNoteThreshold(value?.noteThreshold) ? Math.round(value.noteThreshold * 100) / 100 : DEFAULT_NOTE_THRESHOLD,
    useWebGPU: value?.useWebGPU === true,
  };
}
