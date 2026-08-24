import assert from "node:assert/strict";
import test from "node:test";

import { retryRead } from "../app/resilient-read.ts";

test("retries transient read failures and returns the first successful result", async () => {
  const attempts = [];
  const waits = [];

  const result = await retryRead(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new Error("temporary database delay");
      return { ok: true };
    },
    [250, 750],
    async (milliseconds) => { waits.push(milliseconds); },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(waits, [250, 750]);
});

test("stops after the bounded retry schedule is exhausted", async () => {
  let attempts = 0;
  await assert.rejects(
    retryRead(
      async () => {
        attempts += 1;
        throw new Error("database unavailable");
      },
      [0, 0],
      async () => {},
    ),
    /database unavailable/,
  );
  assert.equal(attempts, 3);
});
