import { QuestionReference } from "../types";

export function isQuestionNumber(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\\/]/.test(value);
}

export function isQuestionReference(value: unknown): value is QuestionReference {
  return typeof value === "object" && value !== null && "id" in value && isQuestionNumber(value.id) &&
    "source" in value && isQuestionNumber(value.source);
}

export function questionKey(question: QuestionReference): string {
  return JSON.stringify([question.source, question.id]);
}
