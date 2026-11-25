import { isScalar } from "yaml";
import { QuestionReference } from "../types";

export function isQuestionNumber(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\\/]/.test(value);
}

export function readYamlQuestionNumber(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined;
  if (isQuestionNumber(node.value)) return node.value;
  if (typeof node.value === "number" && node.source && /^\d+$/.test(node.source)) return node.source;
  return undefined;
}

export function isQuestionReference(value: unknown): value is QuestionReference {
  return typeof value === "object" && value !== null && "id" in value && isQuestionNumber(value.id) &&
    "source" in value && typeof value.source === "string" && !/[\\/]/.test(value.source);
}

export function questionKey(question: QuestionReference): string {
  return JSON.stringify([question.source, question.id]);
}

export function sourceLabel(source: string): string {
  return source || "フォルダ直下";
}
