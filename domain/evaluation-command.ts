import type { AuthorizedActor } from "./access-control.ts";
import { evaluateSubmissionEligibility } from "./fairness.ts";

export type RatingInput = {
  criterionId: string;
  responseStatus: "rated" | "not_observed";
  value: number | null;
};

type EvaluationPayload = {
  periodId: string;
  shiftId: string;
  subjectMembershipId: string;
  ratings: RatingInput[];
};

type SubmissionEvidence = {
  subjectOrganizationId: string;
  sharedShift: boolean;
  periodOpen: boolean;
  alreadySubmitted: boolean;
  raterCanEvaluate: boolean;
  subjectCanBeEvaluated: boolean;
  validCriterionIds: string[];
};

type EvaluationCommandInput = {
  actor: AuthorizedActor;
  payload: EvaluationPayload & Record<string, unknown>;
  evidence: SubmissionEvidence;
};

type RejectionReason =
  | "rater_must_come_from_session"
  | "ratings_required"
  | "duplicate_criterion"
  | "unknown_criterion"
  | "missing_criterion_response"
  | "invalid_rating_response"
  | "invalid_rating_value"
  | "insufficient_observation"
  | "self_evaluation"
  | "rater_not_participating"
  | "subject_not_participating"
  | "different_organization"
  | "no_shared_shift"
  | "period_closed"
  | "duplicate_submission";

type EvaluationCommandResult =
  | {
      accepted: true;
      command: {
        organizationId: string;
        periodId: string;
        shiftId: string;
        raterMembershipId: string;
        subjectMembershipId: string;
        ratings: RatingInput[];
      };
    }
  | {
      accepted: false;
      status: 403 | 409 | 422;
      reason: RejectionReason;
    };

export function prepareEvaluationSubmission(
  input: EvaluationCommandInput,
): EvaluationCommandResult {
  if (Object.hasOwn(input.payload, "raterMembershipId")) {
    return reject(422, "rater_must_come_from_session");
  }

  if (!Array.isArray(input.payload.ratings) || input.payload.ratings.length === 0) {
    return reject(422, "ratings_required");
  }

  const criterionIds = input.payload.ratings.map(({ criterionId }) => criterionId);
  if (new Set(criterionIds).size !== criterionIds.length) {
    return reject(422, "duplicate_criterion");
  }

  const validCriterionIds = new Set(input.evidence.validCriterionIds);
  if (criterionIds.some((criterionId) => !validCriterionIds.has(criterionId))) {
    return reject(422, "unknown_criterion");
  }

  if (
    validCriterionIds.size !== criterionIds.length ||
    input.evidence.validCriterionIds.some(
      (criterionId) => !criterionIds.includes(criterionId),
    )
  ) {
    return reject(422, "missing_criterion_response");
  }

  if (
    input.payload.ratings.some(
      ({ responseStatus, value }) =>
        (responseStatus !== "rated" && responseStatus !== "not_observed") ||
        (responseStatus === "not_observed" && value !== null) ||
        (responseStatus === "rated" && value === null),
    )
  ) {
    return reject(422, "invalid_rating_response");
  }

  if (
    input.payload.ratings.some(
      ({ responseStatus, value }) =>
        responseStatus === "rated" &&
        (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5),
    )
  ) {
    return reject(422, "invalid_rating_value");
  }

  if (
    input.payload.ratings.filter(
      ({ responseStatus }) => responseStatus === "rated",
    ).length < 2
  ) {
    return reject(422, "insufficient_observation");
  }

  const eligibility = evaluateSubmissionEligibility({
    raterId: input.actor.membershipId,
    subjectId: input.payload.subjectMembershipId,
    sameOrganization:
      input.actor.organizationId === input.evidence.subjectOrganizationId,
    sharedShift: input.evidence.sharedShift,
    periodOpen: input.evidence.periodOpen,
    alreadySubmitted: input.evidence.alreadySubmitted,
    raterCanEvaluate: input.evidence.raterCanEvaluate,
    subjectCanBeEvaluated: input.evidence.subjectCanBeEvaluated,
  });

  if (!eligibility.allowed) {
    return reject(
      eligibility.reason === "duplicate_submission" ? 409 : 403,
      eligibility.reason,
    );
  }

  return {
    accepted: true,
    command: {
      organizationId: input.actor.organizationId,
      periodId: input.payload.periodId,
      shiftId: input.payload.shiftId,
      raterMembershipId: input.actor.membershipId,
      subjectMembershipId: input.payload.subjectMembershipId,
      ratings: input.payload.ratings.map((rating) => ({ ...rating })),
    },
  };
}

function reject(
  status: 403 | 409 | 422,
  reason: RejectionReason,
): EvaluationCommandResult {
  return { accepted: false, status, reason };
}
