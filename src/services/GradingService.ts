
import {
  Question,
  GradeResult,
} from "../types";

export class GradingService {
  static grade(
    question: Question,
    selected: string[]
  ): GradeResult {
    if (question.excluded) {
      return "excluded";
    }

    if (question.type === "numeric") {
      if (selected.length !== 1) {
        return "incorrect";
      }

      const matched = question.answer.some(
        accepted =>
          accepted.length === 1 &&
          accepted[0] === selected[0]
      );

      return matched ? "correct" : "incorrect";
    }

    const sorted = [...selected].sort();

    const matched = question.answer.some(
      accepted => {
        const expected = [...accepted].sort();

        return (
          sorted.length === expected.length &&
          sorted.every(
            (value, index) =>
              value === expected[index]
          )
        );
      }
    );

    return matched ? "correct" : "incorrect";
  }
}
