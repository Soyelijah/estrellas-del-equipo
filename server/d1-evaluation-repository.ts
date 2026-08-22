import type { AuthorizedActor } from "../domain/access-control.ts";
import type {
  EvaluationRepository,
  SubmissionEvidence,
} from "./evaluation-service.ts";

type PreparedStatementLike = {
  bind(...values: unknown[]): PreparedStatementLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};

type D1DatabaseLike = {
  prepare(sql: string): PreparedStatementLike;
  batch(statements: PreparedStatementLike[]): Promise<unknown>;
};

type EvaluationPayload = {
  periodId: string;
  shiftId: string;
  subjectMembershipId: string;
  ratings: Array<{
    criterionId: string;
    responseStatus: "rated" | "not_observed";
    value: number | null;
  }>;
};

type AuthorizationRow = {
  user_id: string;
  auth_subject: string | null;
  user_status: string;
  user_deleted_at: string | null;
  membership_id: string;
  membership_user_id: string;
  organization_id: string;
  membership_role: string;
  membership_starts_at: string;
  membership_ends_at: string | null;
  membership_deleted_at: string | null;
  organization_status: string;
  organization_deleted_at: string | null;
};

type EvidenceRow = {
  subject_organization_id: string;
  shared_shift: number;
  period_open: number;
  already_submitted: number;
  rater_can_evaluate: number;
  subject_can_be_evaluated: number;
};

type CriterionRow = { id: string };

export class D1EvaluationRepository implements EvaluationRepository {
  private readonly database: D1DatabaseLike;

  constructor(database: D1DatabaseLike) {
    this.database = database;
  }

  async findAuthorizationContext(subjectId: string) {
    const rows = await this.database
      .prepare(`
        SELECT
          u.id AS user_id,
          u.auth_subject,
          u.status AS user_status,
          u.deleted_at AS user_deleted_at,
          m.id AS membership_id,
          m.user_id AS membership_user_id,
          m.organization_id,
          m.role AS membership_role,
          m.starts_at AS membership_starts_at,
          m.ends_at AS membership_ends_at,
          m.deleted_at AS membership_deleted_at,
          o.status AS organization_status,
          o.deleted_at AS organization_deleted_at
        FROM users u
        JOIN memberships m ON m.user_id = u.id
        JOIN organizations o ON o.id = m.organization_id
        WHERE u.auth_subject = ?
        ORDER BY m.starts_at DESC
        LIMIT 2
      `)
      .bind(subjectId)
      .all<AuthorizationRow>();

    if (rows.results.length !== 1) return null;
    const row = rows.results[0];

    return {
      user: {
        id: row.user_id,
        authSubject: row.auth_subject,
        status: row.user_status,
        deletedAt: row.user_deleted_at,
      },
      membership: {
        id: row.membership_id,
        userId: row.membership_user_id,
        organizationId: row.organization_id,
        role: row.membership_role,
        startsAt: row.membership_starts_at,
        endsAt: row.membership_ends_at,
        deletedAt: row.membership_deleted_at,
      },
      organization: {
        id: row.organization_id,
        status: row.organization_status,
        deletedAt: row.organization_deleted_at,
      },
    };
  }

  async findSubmissionEvidence(
    actor: AuthorizedActor,
    payload: EvaluationPayload,
  ): Promise<SubmissionEvidence | null> {
    const row = await this.database
      .prepare(`
        SELECT
          sm.organization_id AS subject_organization_id,
          CASE WHEN ep.status = 'open' AND ep.organization_id = ? THEN 1 ELSE 0 END AS period_open,
          COALESCE(rp.can_evaluate, 0) AS rater_can_evaluate,
          COALESCE(sp.can_be_evaluated, 0) AS subject_can_be_evaluated,
          EXISTS (
            SELECT 1
            FROM shifts s
            JOIN shift_assignments ra ON ra.shift_id = s.id
            JOIN shift_assignments sa ON sa.shift_id = s.id
            WHERE s.id = ?
              AND s.organization_id = ?
              AND s.status <> 'cancelled'
              AND ra.membership_id = ?
              AND sa.membership_id = sm.id
          ) AS shared_shift,
          EXISTS (
            SELECT 1
            FROM evaluation_submissions es
            WHERE es.period_id = ep.id
              AND es.shift_id = ?
              AND es.rater_membership_id = ?
              AND es.subject_membership_id = sm.id
              AND es.status <> 'voided'
          ) AS already_submitted
        FROM memberships sm
        JOIN evaluation_periods ep ON ep.id = ?
        LEFT JOIN evaluation_participations rp
          ON rp.period_id = ep.id AND rp.membership_id = ?
        LEFT JOIN evaluation_participations sp
          ON sp.period_id = ep.id AND sp.membership_id = sm.id
        WHERE sm.id = ?
      `)
      .bind(
        actor.organizationId,
        payload.shiftId,
        actor.organizationId,
        actor.membershipId,
        payload.shiftId,
        actor.membershipId,
        payload.periodId,
        actor.membershipId,
        payload.subjectMembershipId,
      )
      .first<EvidenceRow>();

    if (!row) return null;

    const criteria = await this.database
      .prepare(`
        SELECT c.id
        FROM criteria c
        JOIN evaluation_periods ep ON ep.policy_version_id = c.policy_version_id
        JOIN memberships sm ON sm.id = ?
        WHERE ep.id = ?
          AND c.measurement_type = 'peer_rating'
          AND (c.applicable_job_title IS NULL OR c.applicable_job_title = sm.job_title)
        ORDER BY c.id
      `)
      .bind(payload.subjectMembershipId, payload.periodId)
      .all<CriterionRow>();

    return {
      subjectOrganizationId: row.subject_organization_id,
      sharedShift: row.shared_shift === 1,
      periodOpen: row.period_open === 1,
      alreadySubmitted: row.already_submitted === 1,
      raterCanEvaluate: row.rater_can_evaluate === 1,
      subjectCanBeEvaluated: row.subject_can_be_evaluated === 1,
      validCriterionIds: criteria.results.map(({ id }) => id),
    };
  }

  async saveSubmission(record: Parameters<EvaluationRepository["saveSubmission"]>[0]) {
    const statements = [
      this.database
        .prepare(`
          INSERT INTO evaluation_submissions (
            id, organization_id, period_id, shift_id,
            rater_membership_id, subject_membership_id, status, submitted_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)
        `)
        .bind(
          record.submission.id,
          record.submission.organizationId,
          record.submission.periodId,
          record.submission.shiftId,
          record.submission.raterMembershipId,
          record.submission.subjectMembershipId,
          record.submission.submittedAt,
        ),
      ...record.observations.map((observation) =>
        this.database
          .prepare(`
            INSERT INTO rating_observations (
              id, submission_id, criterion_id, response_status, value, moderation_status
            ) VALUES (?, ?, ?, ?, ?, 'not_required')
          `)
          .bind(
            observation.id,
            record.submission.id,
            observation.criterionId,
            observation.responseStatus,
            observation.value,
          ),
      ),
    ];

    try {
      await this.database.batch(statements);
      return { created: true as const };
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: evaluation_submissions|idx_evaluation_submission_unique/i.test(
          error.message,
        )
      ) {
        return { created: false as const, reason: "duplicate_submission" as const };
      }
      throw error;
    }
  }
}
