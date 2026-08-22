import assert from "node:assert/strict";
import test from "node:test";

test("rejects a self-evaluation", async () => {
  const { evaluateSubmissionEligibility } = await import("../domain/fairness.ts");

  const result = evaluateSubmissionEligibility({
    raterId: "worker-1",
    subjectId: "worker-1",
    sameOrganization: true,
    sharedShift: true,
    periodOpen: true,
    alreadySubmitted: false,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: true,
  });

  assert.deepEqual(result, { allowed: false, reason: "self_evaluation" });
});

test("rejects an evaluation across organizations", async () => {
  const { evaluateSubmissionEligibility } = await import("../domain/fairness.ts");

  const result = evaluateSubmissionEligibility({
    raterId: "worker-1",
    subjectId: "worker-2",
    sameOrganization: false,
    sharedShift: true,
    periodOpen: true,
    alreadySubmitted: false,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: true,
  });

  assert.deepEqual(result, { allowed: false, reason: "different_organization" });
});

test("rejects an evaluation without a shared shift", async () => {
  const { evaluateSubmissionEligibility } = await import("../domain/fairness.ts");

  const result = evaluateSubmissionEligibility({
    raterId: "worker-1",
    subjectId: "worker-2",
    sameOrganization: true,
    sharedShift: false,
    periodOpen: true,
    alreadySubmitted: false,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: true,
  });

  assert.deepEqual(result, { allowed: false, reason: "no_shared_shift" });
});

test("rejects an evaluation after the period closes", async () => {
  const { evaluateSubmissionEligibility } = await import("../domain/fairness.ts");

  const result = evaluateSubmissionEligibility({
    raterId: "worker-1",
    subjectId: "worker-2",
    sameOrganization: true,
    sharedShift: true,
    periodOpen: false,
    alreadySubmitted: false,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: true,
  });

  assert.deepEqual(result, { allowed: false, reason: "period_closed" });
});

test("rejects a duplicate evaluation", async () => {
  const { evaluateSubmissionEligibility } = await import("../domain/fairness.ts");

  const result = evaluateSubmissionEligibility({
    raterId: "worker-1",
    subjectId: "worker-2",
    sameOrganization: true,
    sharedShift: true,
    periodOpen: true,
    alreadySubmitted: true,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: true,
  });

  assert.deepEqual(result, { allowed: false, reason: "duplicate_submission" });
});

test("blocks an administrator who is excluded from peer evaluations", async () => {
  const { evaluateSubmissionEligibility } = await import("../domain/fairness.ts");

  const result = evaluateSubmissionEligibility({
    raterId: "head-waiter",
    subjectId: "waiter-1",
    sameOrganization: true,
    sharedShift: true,
    periodOpen: true,
    alreadySubmitted: false,
    raterCanEvaluate: false,
    subjectCanBeEvaluated: true,
  });

  assert.deepEqual(result, { allowed: false, reason: "rater_not_participating" });
});

test("blocks evaluations of a fixed-share participant such as the cashier", async () => {
  const { evaluateSubmissionEligibility } = await import("../domain/fairness.ts");

  const result = evaluateSubmissionEligibility({
    raterId: "waiter-1",
    subjectId: "cashier",
    sameOrganization: true,
    sharedShift: true,
    periodOpen: true,
    alreadySubmitted: false,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: false,
  });

  assert.deepEqual(result, { allowed: false, reason: "subject_not_participating" });
});

test("withholds a score until the independent-rater and shift minimums are met", async () => {
  const { aggregatePeerRatings } = await import("../domain/fairness.ts");

  const result = aggregatePeerRatings(
    [
      { raterId: "a", shiftId: "shift-1", value: 5, source: "peer" },
      { raterId: "b", shiftId: "shift-1", value: 4, source: "peer" },
      { raterId: "c", shiftId: "shift-2", value: 4, source: "peer" },
      { raterId: "system", shiftId: "shift-2", value: 5, source: "automatic" },
    ],
    { minimumRaters: 5, minimumShifts: 2 },
  );

  assert.deepEqual(result, {
    status: "insufficient_data",
    score: null,
    independentRaters: 3,
    observedShifts: 2,
    peerRatingCount: 3,
    excludedAutomaticCount: 1,
  });
});

test("uses one median contribution per rater so repeated ratings cannot dominate", async () => {
  const { aggregatePeerRatings } = await import("../domain/fairness.ts");

  const result = aggregatePeerRatings(
    [
      { raterId: "a", shiftId: "shift-1", value: 5, source: "peer" },
      { raterId: "a", shiftId: "shift-2", value: 5, source: "peer" },
      { raterId: "a", shiftId: "shift-3", value: 5, source: "peer" },
      { raterId: "b", shiftId: "shift-1", value: 1, source: "peer" },
      { raterId: "c", shiftId: "shift-1", value: 1, source: "peer" },
      { raterId: "d", shiftId: "shift-2", value: 1, source: "peer" },
      { raterId: "e", shiftId: "shift-2", value: 1, source: "peer" },
    ],
    { minimumRaters: 5, minimumShifts: 2 },
  );

  assert.deepEqual(result, {
    status: "publishable",
    score: 1,
    independentRaters: 5,
    observedShifts: 3,
    peerRatingCount: 7,
    excludedAutomaticCount: 0,
  });
});

test("rejects rating values outside the one-to-five scale", async () => {
  const { aggregatePeerRatings } = await import("../domain/fairness.ts");

  assert.throws(
    () =>
      aggregatePeerRatings(
        [{ raterId: "a", shiftId: "shift-1", value: 6, source: "peer" }],
        { minimumRaters: 1, minimumShifts: 1 },
      ),
    { name: "RangeError", message: "Peer rating values must be integers from 1 to 5" },
  );
});

test("turns a low publishable score into coaching review, never automatic discipline", async () => {
  const { classifyPerformanceSignal } = await import("../domain/fairness.ts");

  const result = classifyPerformanceSignal({
    aggregate: {
      status: "publishable",
      score: 2,
      independentRaters: 5,
      observedShifts: 3,
      peerRatingCount: 7,
      excludedAutomaticCount: 0,
    },
    recognitionThreshold: 4.5,
    coachingThreshold: 2.5,
    unresolvedIntegrityAlerts: 0,
  });

  assert.deepEqual(result, {
    status: "coaching_review",
    automaticConsequence: "none",
    reason: "low_score_requires_context_review",
  });
});

test("holds a high score for human review while integrity alerts remain unresolved", async () => {
  const { classifyPerformanceSignal } = await import("../domain/fairness.ts");

  const result = classifyPerformanceSignal({
    aggregate: {
      status: "publishable",
      score: 4.8,
      independentRaters: 8,
      observedShifts: 4,
      peerRatingCount: 10,
      excludedAutomaticCount: 0,
    },
    recognitionThreshold: 4.5,
    coachingThreshold: 2.5,
    unresolvedIntegrityAlerts: 1,
  });

  assert.deepEqual(result, {
    status: "integrity_review",
    automaticConsequence: "none",
    reason: "unresolved_integrity_alerts",
  });
});

test("withholds every performance signal when the aggregate is insufficient", async () => {
  const { classifyPerformanceSignal } = await import("../domain/fairness.ts");

  const result = classifyPerformanceSignal({
    aggregate: {
      status: "insufficient_data",
      score: null,
      independentRaters: 3,
      observedShifts: 2,
      peerRatingCount: 3,
      excludedAutomaticCount: 0,
    },
    recognitionThreshold: 4.5,
    coachingThreshold: 2.5,
    unresolvedIntegrityAlerts: 0,
  });

  assert.deepEqual(result, {
    status: "insufficient_data",
    automaticConsequence: "none",
    reason: "minimum_evidence_not_met",
  });
});

test("marks a high score as a recognition candidate rather than granting a reward", async () => {
  const { classifyPerformanceSignal } = await import("../domain/fairness.ts");

  const result = classifyPerformanceSignal({
    aggregate: {
      status: "publishable",
      score: 4.5,
      independentRaters: 7,
      observedShifts: 4,
      peerRatingCount: 9,
      excludedAutomaticCount: 0,
    },
    recognitionThreshold: 4.5,
    coachingThreshold: 2.5,
    unresolvedIntegrityAlerts: 0,
  });

  assert.deepEqual(result, {
    status: "recognition_candidate",
    automaticConsequence: "none",
    reason: "human_approval_required",
  });
});

test("blocks a tip adjustment when an affected participant has not accepted the agreement", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "bartender", "waiter-1"],
    acceptedParticipantIds: ["lead", "bartender"],
    agreementActive: true,
    agreementEffectiveOn: "2026-09-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -500,
    maximumReductionBasisPoints: 1000,
    reviewed: true,
    appealOpen: false,
    affectsDirectCustomerTip: false,
  });

  assert.deepEqual(result, {
    authorized: false,
    reason: "missing_participant_consent",
  });
});

test("blocks every adjustment to a tip delivered directly by a customer", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "waiter-1"],
    acceptedParticipantIds: ["lead", "waiter-1"],
    agreementActive: true,
    agreementEffectiveOn: "2026-09-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -500,
    maximumReductionBasisPoints: 1000,
    reviewed: true,
    appealOpen: false,
    affectsDirectCustomerTip: true,
  });

  assert.deepEqual(result, {
    authorized: false,
    reason: "direct_customer_tip_is_untouchable",
  });
});

test("authorizes a limited negative factor only under a prior accepted and reviewed agreement", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "bartender", "waiter-1"],
    acceptedParticipantIds: ["lead", "bartender", "waiter-1"],
    agreementActive: true,
    agreementEffectiveOn: "2026-09-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -500,
    maximumReductionBasisPoints: 1000,
    reviewed: true,
    appealOpen: false,
    affectsDirectCustomerTip: false,
  });

  assert.deepEqual(result, { authorized: true, reason: null });
});

test("blocks an adjustment under an inactive agreement", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "waiter-1"],
    acceptedParticipantIds: ["lead", "waiter-1"],
    agreementActive: false,
    agreementEffectiveOn: "2026-09-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -500,
    maximumReductionBasisPoints: 1000,
    reviewed: true,
    appealOpen: false,
    affectsDirectCustomerTip: false,
  });

  assert.deepEqual(result, { authorized: false, reason: "agreement_inactive" });
});

test("blocks a retroactive tip rule", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "waiter-1"],
    acceptedParticipantIds: ["lead", "waiter-1"],
    agreementActive: true,
    agreementEffectiveOn: "2026-10-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -500,
    maximumReductionBasisPoints: 1000,
    reviewed: true,
    appealOpen: false,
    affectsDirectCustomerTip: false,
  });

  assert.deepEqual(result, {
    authorized: false,
    reason: "agreement_not_effective_for_period",
  });
});

test("blocks a reduction larger than the accepted limit", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "waiter-1"],
    acceptedParticipantIds: ["lead", "waiter-1"],
    agreementActive: true,
    agreementEffectiveOn: "2026-09-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -1001,
    maximumReductionBasisPoints: 1000,
    reviewed: true,
    appealOpen: false,
    affectsDirectCustomerTip: false,
  });

  assert.deepEqual(result, {
    authorized: false,
    reason: "reduction_exceeds_agreed_limit",
  });
});

test("blocks a negative adjustment before human review", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "waiter-1"],
    acceptedParticipantIds: ["lead", "waiter-1"],
    agreementActive: true,
    agreementEffectiveOn: "2026-09-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -500,
    maximumReductionBasisPoints: 1000,
    reviewed: false,
    appealOpen: false,
    affectsDirectCustomerTip: false,
  });

  assert.deepEqual(result, { authorized: false, reason: "human_review_required" });
});

test("blocks a negative adjustment while an appeal is open", async () => {
  const { authorizeTipAdjustment } = await import("../domain/fairness.ts");

  const result = authorizeTipAdjustment({
    participantIds: ["lead", "waiter-1"],
    acceptedParticipantIds: ["lead", "waiter-1"],
    agreementActive: true,
    agreementEffectiveOn: "2026-09-01",
    periodStartedOn: "2026-09-01",
    adjustmentBasisPoints: -500,
    maximumReductionBasisPoints: 1000,
    reviewed: true,
    appealOpen: true,
    affectsDirectCustomerTip: false,
  });

  assert.deepEqual(result, { authorized: false, reason: "appeal_pending" });
});
