import assert from "node:assert/strict";
import test from "node:test";

import { submitEvaluation } from "../server/evaluation-service.ts";

const identity = {
  subjectId: "site-user-123",
  email: "garzon1@example.com",
  displayName: "Garzón 1",
};

const authorizationContext = {
  user: {
    id: "user-1",
    authSubject: "site-user-123",
    status: "active",
    deletedAt: null,
  },
  membership: {
    id: "membership-rater",
    userId: "user-1",
    organizationId: "restaurant-1",
    role: "worker",
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: null,
    deletedAt: null,
  },
  organization: {
    id: "restaurant-1",
    status: "active",
    deletedAt: null,
  },
};

const body = {
  periodId: "period-1",
  shiftId: "shift-1",
  subjectMembershipId: "membership-subject",
  ratings: [
    { criterionId: "criterion-teamwork", responseStatus: "rated", value: 5 },
    { criterionId: "criterion-knowledge", responseStatus: "not_observed", value: null },
    { criterionId: "criterion-accuracy", responseStatus: "rated", value: 4 },
  ],
};

const evidence = {
  subjectOrganizationId: "restaurant-1",
  sharedShift: true,
  periodOpen: true,
  alreadySubmitted: false,
  raterCanEvaluate: true,
  subjectCanBeEvaluated: true,
  validCriterionIds: ["criterion-teamwork", "criterion-knowledge", "criterion-accuracy"],
};

function createRepository(overrides = {}) {
  const saved = [];
  return {
    saved,
    async findAuthorizationContext() {
      return authorizationContext;
    },
    async findSubmissionEvidence() {
      return evidence;
    },
    async saveSubmission(record) {
      saved.push(record);
      return { created: true };
    },
    ...overrides,
  };
}

test("requires a signed-in identity before reading or saving evaluation data", async () => {
  const repository = createRepository();

  const result = await submitEvaluation(
    { identity: null, body, now: "2026-08-15T12:00:00.000Z" },
    { repository, createId: () => "unused" },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 401,
    error: "authentication_required",
  });
  assert.deepEqual(repository.saved, []);
});

test("rejects malformed payloads before loading evaluation evidence", async () => {
  let evidenceReads = 0;
  const repository = createRepository({
    async findSubmissionEvidence() {
      evidenceReads += 1;
      return evidence;
    },
  });

  const result = await submitEvaluation(
    {
      identity,
      body: { ...body, periodId: "", ratings: "five" },
      now: "2026-08-15T12:00:00.000Z",
    },
    { repository, createId: () => "unused" },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 422,
    error: "invalid_payload",
  });
  assert.equal(evidenceReads, 0);
});

test("derives the rater from the session and saves one attributed submission", async () => {
  const repository = createRepository();

  const result = await submitEvaluation(
    { identity, body, now: "2026-08-15T12:00:00.000Z" },
    { repository, createId: (() => {
      const ids = ["submission-1", "observation-1", "observation-2", "observation-3"];
      return () => ids.shift();
    })() },
  );

  assert.deepEqual(result, {
    ok: true,
    status: 201,
    submissionId: "submission-1",
  });
  assert.deepEqual(repository.saved, [{
    submission: {
      id: "submission-1",
      organizationId: "restaurant-1",
      periodId: "period-1",
      shiftId: "shift-1",
      raterMembershipId: "membership-rater",
      subjectMembershipId: "membership-subject",
      submittedAt: "2026-08-15T12:00:00.000Z",
    },
    observations: [
      { id: "observation-1", criterionId: "criterion-teamwork", responseStatus: "rated", value: 5 },
      { id: "observation-2", criterionId: "criterion-knowledge", responseStatus: "not_observed", value: null },
      { id: "observation-3", criterionId: "criterion-accuracy", responseStatus: "rated", value: 4 },
    ],
  }]);
});

test("rejects a client-selected rater and does not persist it", async () => {
  const repository = createRepository();
  const result = await submitEvaluation(
    {
      identity,
      body: { ...body, raterMembershipId: "membership-victim" },
      now: "2026-08-15T12:00:00.000Z",
    },
    { repository, createId: () => "unused" },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "rater_must_come_from_session");
  assert.deepEqual(repository.saved, []);
});

test("maps a database uniqueness race to a duplicate conflict", async () => {
  const repository = createRepository({
    async saveSubmission() {
      return { created: false, reason: "duplicate_submission" };
    },
  });

  const result = await submitEvaluation(
    { identity, body, now: "2026-08-15T12:00:00.000Z" },
    { repository, createId: () => "generated-id" },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    error: "duplicate_submission",
  });
});
