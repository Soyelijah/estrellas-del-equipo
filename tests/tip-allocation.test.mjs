import assert from "node:assert/strict";
import test from "node:test";

test("allocates the full tip pool using the agreed percentages", async () => {
  const { allocateTipPool } = await import("../domain/tips.ts");

  const result = allocateTipPool(100_000, [
    { participantId: "lead", percentageBasisPoints: 5000 },
    { participantId: "bartender", percentageBasisPoints: 3000 },
    { participantId: "waiter-1", percentageBasisPoints: 2000 },
  ]);

  assert.deepEqual(result, [
    { participantId: "lead", amountCents: 50_000 },
    { participantId: "bartender", amountCents: 30_000 },
    { participantId: "waiter-1", amountCents: 20_000 },
  ]);
});

test("assigns rounding remainders deterministically without losing a cent", async () => {
  const { allocateTipPool } = await import("../domain/tips.ts");

  const result = allocateTipPool(100, [
    { participantId: "waiter-a", percentageBasisPoints: 3333 },
    { participantId: "waiter-b", percentageBasisPoints: 3333 },
    { participantId: "waiter-c", percentageBasisPoints: 3334 },
  ]);

  assert.deepEqual(result, [
    { participantId: "waiter-a", amountCents: 33 },
    { participantId: "waiter-b", amountCents: 33 },
    { participantId: "waiter-c", amountCents: 34 },
  ]);
  assert.equal(
    result.reduce((sum, allocation) => sum + allocation.amountCents, 0),
    100,
  );
});

test("rejects a percentage table that does not total one hundred percent", async () => {
  const { allocateTipPool } = await import("../domain/tips.ts");

  assert.throws(
    () =>
      allocateTipPool(100_000, [
        { participantId: "lead", percentageBasisPoints: 5000 },
        { participantId: "waiter-1", percentageBasisPoints: 4000 },
      ]),
    { name: "RangeError", message: "Tip percentages must total 10000 basis points" },
  );
});

test("rejects duplicate participants in the same agreement", async () => {
  const { allocateTipPool } = await import("../domain/tips.ts");

  assert.throws(
    () =>
      allocateTipPool(100_000, [
        { participantId: "waiter-1", percentageBasisPoints: 5000 },
        { participantId: "waiter-1", percentageBasisPoints: 5000 },
      ]),
    { name: "TypeError", message: "Each participant must appear exactly once" },
  );
});

test("rejects a negative or fractional tip pool", async () => {
  const { allocateTipPool } = await import("../domain/tips.ts");
  const shares = [{ participantId: "lead", percentageBasisPoints: 10_000 }];

  assert.throws(() => allocateTipPool(-1, shares), {
    name: "RangeError",
    message: "Tip pool must be a non-negative integer amount of cents",
  });
  assert.throws(() => allocateTipPool(100.5, shares), {
    name: "RangeError",
    message: "Tip pool must be a non-negative integer amount of cents",
  });
});

test("rejects negative or fractional agreed percentages", async () => {
  const { allocateTipPool } = await import("../domain/tips.ts");

  assert.throws(
    () =>
      allocateTipPool(100_000, [
        { participantId: "lead", percentageBasisPoints: -1 },
        { participantId: "waiter-1", percentageBasisPoints: 10_001 },
      ]),
    { name: "RangeError", message: "Tip percentages must be non-negative integers" },
  );
  assert.throws(
    () =>
      allocateTipPool(100_000, [
        { participantId: "lead", percentageBasisPoints: 5000.5 },
        { participantId: "waiter-1", percentageBasisPoints: 4999.5 },
      ]),
    { name: "RangeError", message: "Tip percentages must be non-negative integers" },
  );
});

test("allocates the agreed 4.65-factor table without treating experience percentages as final shares", async () => {
  const { allocateTipPoolByWeights } = await import("../domain/tips.ts");

  const result = allocateTipPoolByWeights(46_500, [
    { participantId: "head-waiter", weightPoints: 100 },
    { participantId: "waiter-1", weightPoints: 100 },
    { participantId: "waiter-2", weightPoints: 65 },
    { participantId: "waiter-3", weightPoints: 50 },
    { participantId: "waiter-4", weightPoints: 25 },
    { participantId: "bartender", weightPoints: 75 },
    { participantId: "cashier", weightPoints: 50 },
  ]);

  assert.deepEqual(result, [
    { participantId: "head-waiter", amountCents: 10_000 },
    { participantId: "waiter-1", amountCents: 10_000 },
    { participantId: "waiter-2", amountCents: 6_500 },
    { participantId: "waiter-3", amountCents: 5_000 },
    { participantId: "waiter-4", amountCents: 2_500 },
    { participantId: "bartender", amountCents: 7_500 },
    { participantId: "cashier", amountCents: 5_000 },
  ]);
});

test("weight allocation distributes every cent and remains deterministic", async () => {
  const { allocateTipPoolByWeights } = await import("../domain/tips.ts");

  const result = allocateTipPoolByWeights(100, [
    { participantId: "a", weightPoints: 1 },
    { participantId: "b", weightPoints: 1 },
    { participantId: "c", weightPoints: 1 },
  ]);

  assert.deepEqual(result, [
    { participantId: "a", amountCents: 34 },
    { participantId: "b", amountCents: 33 },
    { participantId: "c", amountCents: 33 },
  ]);
});

test("splits 195000 Chilean pesos by experience factors 1.00, 0.50, and 0.25", async () => {
  const { allocateTipPoolByExperienceFactors } = await import(
    "../domain/tips.ts"
  );

  const result = allocateTipPoolByExperienceFactors(195_000, [
    { participantId: "worker-100", factorHundredths: 100 },
    { participantId: "worker-50", factorHundredths: 50 },
    { participantId: "worker-25", factorHundredths: 25 },
  ]);

  assert.deepEqual(result, [
    { participantId: "worker-100", amountPesos: 111_429 },
    { participantId: "worker-50", amountPesos: 55_714 },
    { participantId: "worker-25", amountPesos: 27_857 },
  ]);
  assert.equal(
    result.reduce((sum, allocation) => sum + allocation.amountPesos, 0),
    195_000,
  );
});

test("formats factor hundredths as decimal experience points", async () => {
  const { formatExperienceFactor } = await import("../domain/tips.ts");

  assert.equal(formatExperienceFactor(100), "1,00");
  assert.equal(formatExperienceFactor(75), "0,75");
  assert.equal(formatExperienceFactor(50), "0,50");
  assert.equal(formatExperienceFactor(25), "0,25");
});
