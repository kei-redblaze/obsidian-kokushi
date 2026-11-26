
import { DASHBOARD_HISTORY_LIMIT } from "../constants";
import { Attempt } from "../types";
import { AttemptService } from "./AttemptService";
import { questionKey } from "./QuestionIdentity";
import { attemptRating } from "./PracticeTargets";

export type DailyStatistics = {
  date: string;
  attempts: number;
  correct: number;
  graded: number;
  accuracy: number | null;
};

export type DashboardStatistics = {
  totalQuestions: number;
  studiedQuestions: number;
  unansweredQuestions: number;
  progressRate: number | null;

  latestCorrect: number;
  latestGraded: number;
  latestAccuracy: number | null;
  reviewQuestions: number;

  totalAttempts: number;
  cumulativeCorrect: number;
  cumulativeGraded: number;
  cumulativeAccuracy: number | null;

  daily: DailyStatistics[];
  recent: Attempt[];
  invalidLines: number;
  availableIds: Set<string>;
};

function dateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).formatToParts(date);

  const get = (type: string): string =>
    parts.find(part => part.type === type)?.value ?? "";

  return [
    get("year"),
    get("month"),
    get("day"),
  ].join("-");
}

function addDays(
  date: string,
  days: number
): string {
  const ms = Date.parse(`${date}T00:00:00Z`);

  return new Date(
    ms + days * 86_400_000
  ).toISOString().slice(0, 10);
}

export class StatisticsService {
  constructor(private attemptService: AttemptService) {}

  async load(
    questionIds: string[]
  ): Promise<DashboardStatistics> {
    const availableIds = new Set(questionIds);
    const { attempts, invalidLines } = await this.attemptService.readAttempts();

    // 問題ごとの最新記録
    // JSONLは記録順に追記される前提
    const latest = new Map<
      string,
      Attempt
    >();

    for (const attempt of attempts) {
      const key = questionKey(attempt);
      if (availableIds.has(key)) {
        latest.set(key, attempt);
      }
    }

    let latestCorrect = 0;
    let reviewQuestions = 0;

    for (const attempt of latest.values()) {
      if (attempt.correct !== false) latestCorrect++;
      const rating = attemptRating(attempt);
      if (rating === "review" || rating === "wrong") reviewQuestions++;
    }

    let cumulativeCorrect = 0;

    // 日付別に全解答試行を集計
    const days = new Map<
      string,
      DailyStatistics
    >();

    for (const attempt of attempts) {
      if (attempt.correct !== false) cumulativeCorrect++;

      const date = dateKey(
        new Date(attempt.timestamp)
      );

      let day = days.get(date);

      if (!day) {
        day = {
          date,
          attempts: 0,
          correct: 0,
          graded: 0,
          accuracy: null,
        };

        days.set(date, day);
      }

      day.attempts++;

      day.graded++;
      if (attempt.correct !== false) day.correct++;
    }

    // 空白日を0回として埋める
    const today = dateKey(new Date());

    const recordedDates = [...days.keys()].sort();

    const firstDate =
      recordedDates[0] &&
      recordedDates[0] < today
        ? recordedDates[0]
        : today;

    const daily: DailyStatistics[] = [];

    for (
      let date = firstDate;
      date <= today;
      date = addDays(date, 1)
    ) {
      const day = days.get(date) ?? {
        date,
        attempts: 0,
        correct: 0,
        graded: 0,
        accuracy: null,
      };

      daily.push({
        ...day,
        accuracy:
          day.graded > 0
            ? day.correct / day.graded * 100
            : null,
      });
    }

    const totalQuestions = availableIds.size;
    const studiedQuestions = latest.size;
    const unansweredQuestions =
      totalQuestions - studiedQuestions;

    return {
      totalQuestions,
      studiedQuestions,
      unansweredQuestions,
      progressRate:
        totalQuestions > 0
          ? studiedQuestions /
            totalQuestions * 100
          : null,

      latestCorrect,
      latestGraded: latest.size,
      latestAccuracy:
        latest.size > 0
          ? latestCorrect /
            latest.size * 100
          : null,
      reviewQuestions,

      totalAttempts: attempts.length,
      cumulativeCorrect,
      cumulativeGraded: attempts.length,
      cumulativeAccuracy:
        attempts.length > 0
          ? cumulativeCorrect /
            attempts.length * 100
          : null,

      daily,
      recent: this.newestFirst(attempts).slice(0, DASHBOARD_HISTORY_LIMIT),
      invalidLines,
      availableIds,
    };
  }
  async getAttemptHistory(): Promise<{ attempts: Attempt[]; invalidLines: number }> {
    const { attempts, invalidLines } = await this.attemptService.readAttempts();
    return { attempts: this.newestFirst(attempts), invalidLines };
  }

  private newestFirst(attempts: Attempt[]): Attempt[] {
    return [...attempts].reverse().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }
}
