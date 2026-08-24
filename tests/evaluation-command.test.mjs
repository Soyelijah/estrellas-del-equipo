import assert from "node:assert/strict";
import test from "node:test";

import { prepareEvaluationSubmission } from "../domain/evaluation-command.ts";

const validInput = {
  actor: {
    userId: "user-1",
    membershipId: "membership-rater",
    organizationId: "restaurant-1",
    role: "worker",
  },
  payload: {
    periodId: "period-1",
    shiftId: "shift-1",
    subjectMembershipId: "membership-subject",
    ratings: [
      { criterionId: "teamwork", responseStatus: "rated", value: 5 },
      { criterionId: "knowledge", responseStatus: "rated", value: 4 },
    ],
  },
  evidence: {
    subjectOrganizationId: "restaurant-1",
    sharedShift: true,
    periodOpen: true,
    alreadySubmitted: false,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: true,
    validCriterionIds: ["teamwork", "knowledge"],
  },
};

test("derives the rater from the authorized actor instead of request data", () => {
  assert.deepEqual(prepareEvaluationSubmission(validInput), {
    accepted: true,
    command: {
      organizationId: "restaurant-1",
      periodId: "period-1",
      shiftId: "shift-1",
      raterMembershipId: "membership-rater",
      subjectMembershipId: "membership-subject",
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 5, evidenceNote: null },
        { criterionId: "knowledge", responseStatus: "rated", value: 4, evidenceNote: null },
      ],
    },
  });
});

test("rejects a payload that attempts to choose the rater identity", () => {
  const result = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      raterMembershipId: "membership-victim",
    },
  });

  assert.deepEqual(result, {
    accepted: false,
    status: 422,
    reason: "rater_must_come_from_session",
  });
});

test("blocks the administrator and a fixed-share subject according to period participation", () => {
  const administrator = prepareEvaluationSubmission({
    ...validInput,
    evidence: { ...validInput.evidence, raterCanEvaluate: false },
  });
  const cashierSubject = prepareEvaluationSubmission({
    ...validInput,
    evidence: { ...validInput.evidence, subjectCanBeEvaluated: false },
  });

  assert.equal(administrator.accepted, false);
  assert.equal(administrator.reason, "rater_not_participating");
  assert.equal(cashierSubject.accepted, false);
  assert.equal(cashierSubject.reason, "subject_not_participating");
});

test("rejects cross-organization and unobserved coworkers", () => {
  const crossOrganization = prepareEvaluationSubmission({
    ...validInput,
    evidence: {
      ...validInput.evidence,
      subjectOrganizationId: "restaurant-2",
    },
  });
  const noSharedShift = prepareEvaluationSubmission({
    ...validInput,
    evidence: { ...validInput.evidence, sharedShift: false },
  });

  assert.equal(crossOrganization.accepted, false);
  assert.equal(crossOrganization.reason, "different_organization");
  assert.equal(noSharedShift.accepted, false);
  assert.equal(noSharedShift.reason, "no_shared_shift");
});

test("rejects duplicate, unknown, missing, or out-of-range ratings", () => {
  const duplicateCriterion = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 5 },
        { criterionId: "teamwork", responseStatus: "rated", value: 4 },
      ],
    },
  });
  const unknownCriterion = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [{ criterionId: "popularity", responseStatus: "rated", value: 5 }],
    },
  });
  const missingRatings = prepareEvaluationSubmission({
    ...validInput,
    payload: { ...validInput.payload, ratings: [] },
  });
  const invalidValue = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 6 },
        { criterionId: "knowledge", responseStatus: "rated", value: 4 },
      ],
    },
  });

  assert.equal(duplicateCriterion.reason, "duplicate_criterion");
  assert.equal(unknownCriterion.reason, "unknown_criterion");
  assert.equal(missingRatings.reason, "ratings_required");
  assert.equal(invalidValue.reason, "invalid_rating_value");
});

test("accepts explicit no-observation responses without turning them into scores", () => {
  const result = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 5 },
        { criterionId: "knowledge", responseStatus: "not_observed", value: null, evidenceNote: "No compartimos esa tarea durante el turno." },
        { criterionId: "accuracy", responseStatus: "rated", value: 4 },
        { criterionId: "explanation", responseStatus: "not_observed", value: null, evidenceNote: "No estuve presente cuando explicó el producto." },
      ],
    },
    evidence: {
      ...validInput.evidence,
      validCriterionIds: ["teamwork", "knowledge", "accuracy", "explanation"],
    },
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.command.ratings[1], {
    criterionId: "knowledge",
    responseStatus: "not_observed",
    value: null,
    evidenceNote: "No compartimos esa tarea durante el turno.",
  });
});

test("requires a useful explanation for every no-observation response", () => {
  const missing = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 5 },
        { criterionId: "knowledge", responseStatus: "not_observed", value: null, evidenceNote: "" },
        { criterionId: "accuracy", responseStatus: "rated", value: 4 },
      ],
    },
    evidence: {
      ...validInput.evidence,
      validCriterionIds: ["teamwork", "knowledge", "accuracy"],
    },
  });
  const tooShort = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 5 },
        { criterionId: "knowledge", responseStatus: "not_observed", value: null, evidenceNote: "No vi" },
        { criterionId: "accuracy", responseStatus: "rated", value: 4 },
      ],
    },
    evidence: {
      ...validInput.evidence,
      validCriterionIds: ["teamwork", "knowledge", "accuracy"],
    },
  });

  assert.equal(missing.reason, "missing_observation_note");
  assert.equal(tooShort.reason, "invalid_observation_note");
});

test("rejects incomplete, contradictory, or insufficiently observed responses", () => {
  const missingCriterion = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 5 },
      ],
    },
  });
  const contradictory = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "not_observed", value: 5 },
        { criterionId: "knowledge", responseStatus: "rated", value: 4 },
      ],
    },
  });
  const insufficientObservation = prepareEvaluationSubmission({
    ...validInput,
    payload: {
      ...validInput.payload,
      ratings: [
        { criterionId: "teamwork", responseStatus: "rated", value: 5 },
        { criterionId: "knowledge", responseStatus: "not_observed", value: null, evidenceNote: "No compartimos esa tarea durante el turno." },
      ],
    },
  });

  assert.equal(missingCriterion.reason, "missing_criterion_response");
  assert.equal(contradictory.reason, "invalid_rating_response");
  assert.equal(insufficientObservation.reason, "insufficient_observation");
});

test("rejects closed periods and repeated submissions", () => {
  const closed = prepareEvaluationSubmission({
    ...validInput,
    evidence: { ...validInput.evidence, periodOpen: false },
  });
  const repeated = prepareEvaluationSubmission({
    ...validInput,
    evidence: { ...validInput.evidence, alreadySubmitted: true },
  });

  assert.equal(closed.reason, "period_closed");
  assert.equal(repeated.reason, "duplicate_submission");
  assert.equal(repeated.status, 409);
});
