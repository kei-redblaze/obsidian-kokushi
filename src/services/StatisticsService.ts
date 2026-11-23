
import { App, TFile } from "obsidian";
import { PATHS } from "../constants";

export type DashboardAttempt = {
  id: string;
  timestamp: string;
  selected: string[];
  correct: boolean | null;
};

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
  recent: DashboardAttempt[];
  invalidLines: number;
  availableIds: Set<string>;
};

function isAttempt(
  value: unknown
): value is DashboardAttempt {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.timestamp === "string" &&
    !Number.isNaN(Date.parse(record.timestamp)) &&
    Array.isArray(record.selected) &&
    record.selected.every(
      item => typeof item === "string"
    ) &&
    (
      record.correct === true ||
      record.correct === false ||
      record.correct === null
    )
  );
}

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
  constructor(private app: App) {}

  async load(
    questionIds: string[]
  ): Promise<DashboardStatistics> {
    const availableIds = new Set(questionIds);
    const attempts: DashboardAttempt[] = [];

    let invalidLines = 0;

    const file = this.app.vault.getAbstractFileByPath(
      PATHS.attempts
    );

    if (file instanceof TFile) {
      const content =
        await this.app.vault.cachedRead(file);

      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;

        try {
          const parsed: unknown = JSON.parse(line);

          if (isAttempt(parsed)) {
            attempts.push(parsed);
          } else {
            invalidLines++;
          }
        } catch {
          invalidLines++;
        }
      }
    }

    // 問題ごとの最新記録
    // JSONLは記録順に追記される前提
    const latest = new Map<
      string,
      DashboardAttempt
    >();

    for (const attempt of attempts) {
      if (availableIds.has(attempt.id)) {
        latest.set(attempt.id, attempt);
      }
    }

    let latestCorrect = 0;
    let latestGraded = 0;
    let reviewQuestions = 0;

    for (const attempt of latest.values()) {
      if (attempt.correct === true) {
        latestCorrect++;
        latestGraded++;
      } else if (attempt.correct === false) {
        latestGraded++;
        reviewQuestions++;
      }
    }

    let cumulativeCorrect = 0;
    let cumulativeGraded = 0;

    // 日付別に全解答試行を集計
    const days = new Map<
      string,
      DailyStatistics
    >();

    for (const attempt of attempts) {
      if (attempt.correct !== null) {
        cumulativeGraded++;

        if (attempt.correct) {
          cumulativeCorrect++;
        }
      }

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

      if (attempt.correct !== null) {
        day.graded++;

        if (attempt.correct) {
          day.correct++;
        }
      }
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
      latestGraded,
      latestAccuracy:
        latestGraded > 0
          ? latestCorrect /
            latestGraded * 100
          : null,
      reviewQuestions,

      totalAttempts: attempts.length,
      cumulativeCorrect,
      cumulativeGraded,
      cumulativeAccuracy:
        cumulativeGraded > 0
          ? cumulativeCorrect /
            cumulativeGraded * 100
          : null,

      daily,
      recent: attempts.slice(-20).reverse(),
      invalidLines,
      availableIds,
    };
  }
}
