import assert from "node:assert/strict";
import test from "node:test";

import { carryForwardDailyScores } from "../domain/monthly-evaluation.ts";

test("uses only previous real days to estimate a missing daily evaluation", () => {
  const result = carryForwardDailyScores([
    { serviceDate: "2026-08-01", actualScore: 4 },
    { serviceDate: "2026-08-02", actualScore: null },
    { serviceDate: "2026-08-03", actualScore: 2 },
  ]);

  assert.equal(result.actualScore, 3);
  assert.equal(result.score, 3.33);
  assert.equal(result.estimatedDays, 1);
  assert.equal(result.unscoredDays, 0);
  assert.deepEqual(result.dailyScores, [
    { serviceDate: "2026-08-01", actualScore: 4, score: 4, source: "actual" },
    { serviceDate: "2026-08-02", actualScore: null, score: 4, source: "estimated_previous_average" },
    { serviceDate: "2026-08-03", actualScore: 2, score: 2, source: "actual" },
  ]);
});

test("does not invent an estimate before the first real observation", () => {
  const result = carryForwardDailyScores([
    { serviceDate: "2026-08-01", actualScore: null },
    { serviceDate: "2026-08-02", actualScore: 5 },
  ]);

  assert.equal(result.score, 5);
  assert.equal(result.estimatedDays, 0);
  assert.equal(result.unscoredDays, 1);
  assert.equal(result.dailyScores[0].source, "unscored");
});

test("keeps a month without real observations unscored", () => {
  const result = carryForwardDailyScores([
    { serviceDate: "2026-08-01", actualScore: null },
  ]);

  assert.equal(result.actualScore, null);
  assert.equal(result.score, null);
  assert.equal(result.estimatedDays, 0);
  assert.equal(result.unscoredDays, 1);
});
