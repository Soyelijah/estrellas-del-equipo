export type EvaluationEligibilityInput = {
  raterId: string;
  subjectId: string;
  sameOrganization: boolean;
  sharedShift: boolean;
  periodOpen: boolean;
  alreadySubmitted: boolean;
  raterCanEvaluate: boolean;
  subjectCanBeEvaluated: boolean;
};

export type EvaluationEligibility =
  | { allowed: true; reason: null }
  | {
      allowed: false;
      reason:
        | "self_evaluation"
        | "rater_not_participating"
        | "subject_not_participating"
        | "different_organization"
        | "no_shared_shift"
        | "period_closed"
        | "duplicate_submission";
    };

export function evaluateSubmissionEligibility(
  input: EvaluationEligibilityInput,
): EvaluationEligibility {
  if (input.raterId === input.subjectId) {
    return { allowed: false, reason: "self_evaluation" };
  }
  if (!input.raterCanEvaluate) {
    return { allowed: false, reason: "rater_not_participating" };
  }
  if (!input.subjectCanBeEvaluated) {
    return { allowed: false, reason: "subject_not_participating" };
  }
  if (!input.sameOrganization) {
    return { allowed: false, reason: "different_organization" };
  }
  if (!input.sharedShift) {
    return { allowed: false, reason: "no_shared_shift" };
  }
  if (!input.periodOpen) {
    return { allowed: false, reason: "period_closed" };
  }
  if (input.alreadySubmitted) {
    return { allowed: false, reason: "duplicate_submission" };
  }

  return { allowed: true, reason: null };
}

export type RatingObservation = {
  raterId: string;
  shiftId: string;
  value: number;
  source: "peer" | "automatic";
};

export type AggregationPolicy = {
  minimumRaters: number;
  minimumShifts: number;
};

export type PeerRatingAggregate = {
  status: "insufficient_data" | "publishable";
  score: number | null;
  independentRaters: number;
  observedShifts: number;
  peerRatingCount: number;
  excludedAutomaticCount: number;
};

export function aggregatePeerRatings(
  observations: RatingObservation[],
  policy: AggregationPolicy,
): PeerRatingAggregate {
  const peerRatings = observations.filter(({ source }) => source === "peer");
  if (
    peerRatings.some(
      ({ value }) => !Number.isInteger(value) || value < 1 || value > 5,
    )
  ) {
    throw new RangeError("Peer rating values must be integers from 1 to 5");
  }
  const ratingsByRater = new Map<string, number[]>();

  for (const observation of peerRatings) {
    const current = ratingsByRater.get(observation.raterId) ?? [];
    current.push(observation.value);
    ratingsByRater.set(observation.raterId, current);
  }

  const independentRaters = ratingsByRater.size;
  const observedShifts = new Set(peerRatings.map(({ shiftId }) => shiftId)).size;
  const enoughData =
    independentRaters >= policy.minimumRaters &&
    observedShifts >= policy.minimumShifts;

  const score = enoughData
    ? median([...ratingsByRater.values()].map((ratings) => median(ratings)))
    : null;

  return {
    status: enoughData ? "publishable" : "insufficient_data",
    score,
    independentRaters,
    observedShifts,
    peerRatingCount: peerRatings.length,
    excludedAutomaticCount: observations.length - peerRatings.length,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

export type PerformanceSignalInput = {
  aggregate: PeerRatingAggregate;
  recognitionThreshold: number;
  coachingThreshold: number;
  unresolvedIntegrityAlerts: number;
};

export type PerformanceSignal = {
  status:
    | "insufficient_data"
    | "integrity_review"
    | "coaching_review"
    | "recognition_candidate"
    | "stable";
  automaticConsequence: "none";
  reason:
    | "minimum_evidence_not_met"
    | "unresolved_integrity_alerts"
    | "low_score_requires_context_review"
    | "human_approval_required"
    | "no_action_required";
};

export function classifyPerformanceSignal(
  input: PerformanceSignalInput,
): PerformanceSignal {
  if (input.aggregate.status === "insufficient_data") {
    return {
      status: "insufficient_data",
      automaticConsequence: "none",
      reason: "minimum_evidence_not_met",
    };
  }

  if (input.unresolvedIntegrityAlerts > 0) {
    return {
      status: "integrity_review",
      automaticConsequence: "none",
      reason: "unresolved_integrity_alerts",
    };
  }

  if (
    input.aggregate.score !== null &&
    input.aggregate.score <= input.coachingThreshold
  ) {
    return {
      status: "coaching_review",
      automaticConsequence: "none",
      reason: "low_score_requires_context_review",
    };
  }

  if (
    input.aggregate.score !== null &&
    input.aggregate.score >= input.recognitionThreshold
  ) {
    return {
      status: "recognition_candidate",
      automaticConsequence: "none",
      reason: "human_approval_required",
    };
  }

  return {
    status: "stable",
    automaticConsequence: "none",
    reason: "no_action_required",
  };
}

export type TipAdjustmentAuthorizationInput = {
  participantIds: string[];
  acceptedParticipantIds: string[];
  agreementActive: boolean;
  agreementEffectiveOn: string;
  periodStartedOn: string;
  adjustmentBasisPoints: number;
  maximumReductionBasisPoints: number;
  reviewed: boolean;
  appealOpen: boolean;
  affectsDirectCustomerTip: boolean;
};

export type TipAdjustmentAuthorization =
  | { authorized: true; reason: null }
  | {
      authorized: false;
      reason:
        | "missing_participant_consent"
        | "agreement_inactive"
        | "agreement_not_effective_for_period"
        | "direct_customer_tip_is_untouchable"
        | "reduction_exceeds_agreed_limit"
        | "human_review_required"
        | "appeal_pending";
    };

export function authorizeTipAdjustment(
  input: TipAdjustmentAuthorizationInput,
): TipAdjustmentAuthorization {
  const accepted = new Set(input.acceptedParticipantIds);
  if (input.participantIds.some((participantId) => !accepted.has(participantId))) {
    return { authorized: false, reason: "missing_participant_consent" };
  }

  if (!input.agreementActive) {
    return { authorized: false, reason: "agreement_inactive" };
  }

  if (input.agreementEffectiveOn > input.periodStartedOn) {
    return {
      authorized: false,
      reason: "agreement_not_effective_for_period",
    };
  }

  if (input.affectsDirectCustomerTip) {
    return { authorized: false, reason: "direct_customer_tip_is_untouchable" };
  }

  if (input.adjustmentBasisPoints < -input.maximumReductionBasisPoints) {
    return { authorized: false, reason: "reduction_exceeds_agreed_limit" };
  }

  if (input.adjustmentBasisPoints < 0 && !input.reviewed) {
    return { authorized: false, reason: "human_review_required" };
  }

  if (input.adjustmentBasisPoints < 0 && input.appealOpen) {
    return { authorized: false, reason: "appeal_pending" };
  }

  return { authorized: true, reason: null };
}
