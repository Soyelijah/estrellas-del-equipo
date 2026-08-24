export type DailyObservedScore = {
  serviceDate: string;
  actualScore: number | null;
};

export type DailyEffectiveScore = DailyObservedScore & {
  score: number | null;
  source: "actual" | "estimated_previous_average" | "unscored";
};

export function carryForwardDailyScores(rows: DailyObservedScore[]) {
  const previousActualScores: number[] = [];
  const dailyScores: DailyEffectiveScore[] = [...rows]
    .sort((left, right) => left.serviceDate.localeCompare(right.serviceDate))
    .map((row) => {
      if (row.actualScore !== null) {
        const actualScore = roundScore(row.actualScore);
        previousActualScores.push(actualScore);
        return { ...row, actualScore, score: actualScore, source: "actual" as const };
      }

      if (previousActualScores.length === 0) {
        return { ...row, score: null, source: "unscored" as const };
      }

      return {
        ...row,
        score: roundScore(average(previousActualScores)),
        source: "estimated_previous_average" as const,
      };
    });

  const actualScores = dailyScores.flatMap((row) =>
    row.actualScore === null ? [] : [row.actualScore],
  );
  const effectiveScores = dailyScores.flatMap((row) =>
    row.score === null ? [] : [row.score],
  );

  return {
    actualScore:
      actualScores.length === 0 ? null : roundScore(average(actualScores)),
    score:
      effectiveScores.length === 0 ? null : roundScore(average(effectiveScores)),
    estimatedDays: dailyScores.filter(
      (row) => row.source === "estimated_previous_average",
    ).length,
    unscoredDays: dailyScores.filter((row) => row.source === "unscored").length,
    dailyScores,
  };
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}
