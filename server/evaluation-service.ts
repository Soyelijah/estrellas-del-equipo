import {
  authorizeMembership,
  type AuthorizedActor,
} from "../domain/access-control.ts";
import {
  prepareEvaluationSubmission,
  type RatingInput,
} from "../domain/evaluation-command.ts";
import type { AuthenticatedIdentity } from "../domain/identity.ts";

type AuthorizationContext = {
  user: {
    id: string;
    authSubject: string | null;
    status: string;
    deletedAt: string | null;
  };
  membership: {
    id: string;
    userId: string;
    organizationId: string;
    role: string;
    startsAt: string;
    endsAt: string | null;
    deletedAt: string | null;
  };
  organization: {
    id: string;
    status: string;
    deletedAt: string | null;
  };
};

type EvaluationPayload = {
  periodId: string;
  shiftId: string;
  subjectMembershipId: string;
  ratings: RatingInput[];
} & Record<string, unknown>;

export type SubmissionEvidence = {
  subjectOrganizationId: string;
  sharedShift: boolean;
  periodOpen: boolean;
  alreadySubmitted: boolean;
  raterCanEvaluate: boolean;
  subjectCanBeEvaluated: boolean;
  validCriterionIds: string[];
};

type SubmissionRecord = {
  submission: {
    id: string;
    organizationId: string;
    periodId: string;
    shiftId: string;
    raterMembershipId: string;
    subjectMembershipId: string;
    submittedAt: string;
  };
  observations: Array<{
    id: string;
    criterionId: string;
    responseStatus: "rated" | "not_observed";
    value: number | null;
  }>;
};

export interface EvaluationRepository {
  findAuthorizationContext(
    subjectId: string,
  ): Promise<AuthorizationContext | null>;
  findSubmissionEvidence(
    actor: AuthorizedActor,
    payload: EvaluationPayload,
  ): Promise<SubmissionEvidence | null>;
  saveSubmission(
    record: SubmissionRecord,
  ): Promise<
    | { created: true }
    | { created: false; reason: "duplicate_submission" }
  >;
}

type SubmitEvaluationInput = {
  identity: AuthenticatedIdentity | null;
  body: unknown;
  now: string;
};

type SubmitEvaluationResult =
  | { ok: true; status: 201; submissionId: string }
  | { ok: false; status: 401 | 403 | 404 | 409 | 422; error: string };

export async function submitEvaluation(
  input: SubmitEvaluationInput,
  dependencies: {
    repository: EvaluationRepository;
    createId: () => string;
  },
): Promise<SubmitEvaluationResult> {
  if (!input.identity) {
    return failure(401, "authentication_required");
  }

  const context = await dependencies.repository.findAuthorizationContext(
    input.identity.subjectId,
  );
  const authorization = authorizeMembership({
    identity: input.identity,
    user: context?.user ?? null,
    membership: context?.membership ?? null,
    organization: context?.organization ?? null,
    now: input.now,
  });

  if (!authorization.ok) {
    return failure(authorization.status, authorization.reason);
  }

  const payload = parseEvaluationPayload(input.body);
  if (!payload) {
    return failure(422, "invalid_payload");
  }

  const evidence = await dependencies.repository.findSubmissionEvidence(
    authorization.actor,
    payload,
  );
  if (!evidence) {
    return failure(404, "evaluation_context_not_found");
  }

  const prepared = prepareEvaluationSubmission({
    actor: authorization.actor,
    payload,
    evidence,
  });
  if (!prepared.accepted) {
    return failure(prepared.status, prepared.reason);
  }

  const submissionId = dependencies.createId();
  const saveResult = await dependencies.repository.saveSubmission({
    submission: {
      id: submissionId,
      organizationId: prepared.command.organizationId,
      periodId: prepared.command.periodId,
      shiftId: prepared.command.shiftId,
      raterMembershipId: prepared.command.raterMembershipId,
      subjectMembershipId: prepared.command.subjectMembershipId,
      submittedAt: input.now,
    },
    observations: prepared.command.ratings.map((rating) => ({
      id: dependencies.createId(),
      criterionId: rating.criterionId,
      responseStatus: rating.responseStatus,
      value: rating.value,
    })),
  });

  if (!saveResult.created) {
    return failure(409, saveResult.reason);
  }

  return { ok: true, status: 201, submissionId };
}

function parseEvaluationPayload(body: unknown): EvaluationPayload | null {
  if (!isRecord(body)) return null;
  if (
    !isBoundedIdentifier(body.periodId) ||
    !isBoundedIdentifier(body.shiftId) ||
    !isBoundedIdentifier(body.subjectMembershipId) ||
    !Array.isArray(body.ratings) ||
    body.ratings.length > 32
  ) {
    return null;
  }

  const ratings = body.ratings.map((rating) => {
    if (
      !isRecord(rating) ||
      !isBoundedIdentifier(rating.criterionId) ||
      (rating.responseStatus !== "rated" && rating.responseStatus !== "not_observed") ||
      (typeof rating.value !== "number" && rating.value !== null)
    ) {
      return null;
    }
    return {
      criterionId: rating.criterionId,
      responseStatus: rating.responseStatus,
      value: rating.value,
    };
  });
  if (ratings.some((rating) => rating === null)) return null;

  return {
    ...body,
    periodId: body.periodId,
    shiftId: body.shiftId,
    subjectMembershipId: body.subjectMembershipId,
    ratings: ratings as RatingInput[],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function failure(
  status: 401 | 403 | 404 | 409 | 422,
  error: string,
): SubmitEvaluationResult {
  return { ok: false, status, error };
}
