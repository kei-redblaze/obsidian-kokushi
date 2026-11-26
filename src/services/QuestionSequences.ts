import { Question } from "../types";

export function questionUnits(questions: Question[]): Question[][] {
  const units: Question[][] = [];
  const sequences = new Map<string, Question[]>();
  for (const question of questions) {
    if (!question.sequence) {
      units.push([question]);
      continue;
    }
    let unit = sequences.get(question.path);
    if (!unit) {
      unit = [];
      sequences.set(question.path, unit);
      units.push(unit);
    }
    unit.push(question);
  }
  for (const unit of sequences.values()) unit.sort((a, b) => (a.sequence?.index ?? 0) - (b.sequence?.index ?? 0));
  return units;
}

export function fitQuestionUnits(units: Question[][], limit: number): Question[] {
  const chosen: Question[] = [];
  for (const unit of units) {
    if (unit.length <= limit - chosen.length) chosen.push(...unit);
  }
  return chosen;
}
