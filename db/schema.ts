import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Santiago"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [
  check("organizations_status_check", sql`${table.status} IN ('active', 'suspended')`),
  index("idx_organizations_status").on(table.status),
]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  loginIdentifier: text("login_identifier").notNull(),
  authSubject: text("auth_subject"),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("invited"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("idx_users_login_identifier_unique").on(table.loginIdentifier),
  uniqueIndex("idx_users_auth_subject_unique").on(table.authSubject),
  check("users_status_check", sql`${table.status} IN ('invited', 'active', 'locked', 'disabled')`),
  index("idx_users_status").on(table.status),
]);

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("idx_auth_sessions_token_hash_unique").on(table.tokenHash),
  index("idx_auth_sessions_user_expires_at").on(table.userId, table.expiresAt),
]);

export const bootstrapGuards = sqliteTable("bootstrap_guards", {
  key: text("key").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  role: text("role").notNull(),
  jobTitle: text("job_title").notNull(),
  tipFactorHundredths: integer("tip_factor_hundredths"),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("idx_memberships_organization_user_unique").on(table.organizationId, table.userId),
  check("memberships_role_check", sql`${table.role} IN ('worker', 'team_lead', 'admin', 'independent_reviewer')`),
  check("memberships_tip_factor_check", sql`${table.tipFactorHundredths} IS NULL OR (${table.tipFactorHundredths} BETWEEN 1 AND 100)`),
  index("idx_memberships_organization_role").on(table.organizationId, table.role),
  index("idx_memberships_user").on(table.userId),
]);

export const tipAgreements = sqliteTable("tip_agreements", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveUntil: text("effective_until"),
  status: text("status").notNull().default("draft"),
  createdByMembershipId: text("created_by_membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_tip_agreements_organization_version_unique").on(table.organizationId, table.version),
  check("tip_agreements_version_check", sql`${table.version} > 0`),
  check("tip_agreements_status_check", sql`${table.status} IN ('draft', 'active', 'superseded', 'cancelled')`),
  index("idx_tip_agreements_organization_status").on(table.organizationId, table.status),
]);

export const tipAgreementParticipants = sqliteTable("tip_agreement_participants", {
  id: text("id").primaryKey(),
  agreementId: text("agreement_id").notNull().references(() => tipAgreements.id, { onDelete: "cascade" }),
  membershipId: text("membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  factorHundredths: integer("factor_hundredths").notNull(),
  acceptedAt: text("accepted_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_tip_agreement_participant_unique").on(table.agreementId, table.membershipId),
  check("tip_agreement_factor_check", sql`${table.factorHundredths} > 0`),
  index("idx_tip_agreement_participants_membership").on(table.membershipId),
]);

export const policyVersions = sqliteTable("policy_versions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  status: text("status").notNull().default("draft"),
  minimumRaters: integer("minimum_raters").notNull().default(3),
  minimumShifts: integer("minimum_shifts").notNull().default(3),
  createdByMembershipId: text("created_by_membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_policy_versions_organization_version_unique").on(table.organizationId, table.version),
  check("policy_versions_version_check", sql`${table.version} > 0`),
  check("policy_versions_minimums_check", sql`${table.minimumRaters} >= 2 AND ${table.minimumShifts} >= 1`),
  check("policy_versions_status_check", sql`${table.status} IN ('draft', 'active', 'superseded')`),
  index("idx_policy_versions_organization_status").on(table.organizationId, table.status),
]);

export const criteria = sqliteTable("criteria", {
  id: text("id").primaryKey(),
  policyVersionId: text("policy_version_id").notNull().references(() => policyVersions.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  applicableJobTitle: text("applicable_job_title"),
  measurementType: text("measurement_type").notNull(),
  weightBasisPoints: integer("weight_basis_points").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_criteria_policy_code_unique").on(table.policyVersionId, table.code),
  check("criteria_measurement_type_check", sql`${table.measurementType} IN ('peer_rating', 'leader_observation', 'knowledge_check', 'operational_metric', 'improvement')`),
  check("criteria_weight_check", sql`${table.weightBasisPoints} >= 0 AND ${table.weightBasisPoints} <= 10000`),
  index("idx_criteria_policy_category").on(table.policyVersionId, table.category),
]);

export const evaluationPeriods = sqliteTable("evaluation_periods", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  policyVersionId: text("policy_version_id").notNull().references(() => policyVersions.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("evaluation_periods_dates_check", sql`${table.endsAt} > ${table.startsAt}`),
  check("evaluation_periods_status_check", sql`${table.status} IN ('draft', 'open', 'closed', 'under_review', 'published')`),
  index("idx_evaluation_periods_organization_status").on(table.organizationId, table.status),
  index("idx_evaluation_periods_organization_dates").on(table.organizationId, table.startsAt, table.endsAt),
]);

export const evaluationParticipations = sqliteTable("evaluation_participations", {
  id: text("id").primaryKey(),
  periodId: text("period_id").notNull().references(() => evaluationPeriods.id, { onDelete: "cascade" }),
  membershipId: text("membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  canEvaluate: integer("can_evaluate", { mode: "boolean" }).notNull().default(true),
  canBeEvaluated: integer("can_be_evaluated", { mode: "boolean" }).notNull().default(true),
  exclusionReason: text("exclusion_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_evaluation_participation_period_member_unique").on(table.periodId, table.membershipId),
  index("idx_evaluation_participation_membership").on(table.membershipId),
]);

export const shifts = sqliteTable("shifts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodId: text("period_id").references(() => evaluationPeriods.id, { onDelete: "restrict" }),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  section: text("section").notNull(),
  status: text("status").notNull().default("scheduled"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("shifts_dates_check", sql`${table.endsAt} > ${table.startsAt}`),
  check("shifts_status_check", sql`${table.status} IN ('scheduled', 'open', 'closed', 'cancelled')`),
  index("idx_shifts_organization_starts_at").on(table.organizationId, table.startsAt),
  index("idx_shifts_period_starts_at").on(table.periodId, table.startsAt),
]);

export const shiftAssignments = sqliteTable("shift_assignments", {
  id: text("id").primaryKey(),
  shiftId: text("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  membershipId: text("membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  roleDuringShift: text("role_during_shift").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_shift_assignments_shift_membership_unique").on(table.shiftId, table.membershipId),
  index("idx_shift_assignments_membership").on(table.membershipId),
]);

export const evaluationSubmissions = sqliteTable("evaluation_submissions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodId: text("period_id").notNull().references(() => evaluationPeriods.id, { onDelete: "restrict" }),
  shiftId: text("shift_id").notNull().references(() => shifts.id, { onDelete: "restrict" }),
  raterMembershipId: text("rater_membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  subjectMembershipId: text("subject_membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("submitted"),
  submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_evaluation_submission_unique").on(table.periodId, table.shiftId, table.raterMembershipId, table.subjectMembershipId),
  check("evaluation_submissions_no_self_check", sql`${table.raterMembershipId} <> ${table.subjectMembershipId}`),
  check("evaluation_submissions_status_check", sql`${table.status} IN ('submitted', 'reopened', 'voided')`),
  index("idx_evaluation_submissions_subject_period").on(table.subjectMembershipId, table.periodId),
  index("idx_evaluation_submissions_rater_period").on(table.raterMembershipId, table.periodId),
]);

export const ratingObservations = sqliteTable("rating_observations", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull().references(() => evaluationSubmissions.id, { onDelete: "cascade" }),
  criterionId: text("criterion_id").notNull().references(() => criteria.id, { onDelete: "restrict" }),
  responseStatus: text("response_status").notNull().default("rated"),
  value: integer("value"),
  evidenceNote: text("evidence_note"),
  moderationStatus: text("moderation_status").notNull().default("not_required"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_rating_observation_submission_criterion_unique").on(table.submissionId, table.criterionId),
  check("rating_observations_response_check", sql`(${table.responseStatus} = 'rated' AND ${table.value} BETWEEN 1 AND 5) OR (${table.responseStatus} = 'not_observed' AND ${table.value} IS NULL)`),
  check("rating_observations_moderation_check", sql`${table.moderationStatus} IN ('not_required', 'pending', 'approved', 'redacted', 'rejected')`),
  index("idx_rating_observations_criterion").on(table.criterionId),
]);

export const resultSnapshots = sqliteTable("result_snapshots", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodId: text("period_id").notNull().references(() => evaluationPeriods.id, { onDelete: "restrict" }),
  subjectMembershipId: text("subject_membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  criterionId: text("criterion_id").references(() => criteria.id, { onDelete: "restrict" }),
  algorithmVersion: integer("algorithm_version").notNull(),
  scoreMilli: integer("score_milli"),
  independentRaters: integer("independent_raters").notNull(),
  observedShifts: integer("observed_shifts").notNull(),
  confidence: text("confidence").notNull(),
  computedAt: text("computed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("result_snapshots_score_check", sql`${table.scoreMilli} IS NULL OR ${table.scoreMilli} BETWEEN 1000 AND 5000`),
  check("result_snapshots_counts_check", sql`${table.independentRaters} >= 0 AND ${table.observedShifts} >= 0`),
  check("result_snapshots_confidence_check", sql`${table.confidence} IN ('insufficient', 'publishable')`),
  index("idx_result_snapshots_subject_period").on(table.subjectMembershipId, table.periodId),
]);

export const integrityAlerts = sqliteTable("integrity_alerts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodId: text("period_id").notNull().references(() => evaluationPeriods.id, { onDelete: "restrict" }),
  subjectMembershipId: text("subject_membership_id").references(() => memberships.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  status: text("status").notNull().default("open"),
  evidenceJson: text("evidence_json").notNull(),
  reviewedByMembershipId: text("reviewed_by_membership_id").references(() => memberships.id, { onDelete: "restrict" }),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("integrity_alerts_status_check", sql`${table.status} IN ('open', 'reviewing', 'resolved', 'dismissed')`),
  index("idx_integrity_alerts_organization_status").on(table.organizationId, table.status),
  index("idx_integrity_alerts_period_subject").on(table.periodId, table.subjectMembershipId),
]);

export const reviewRequests = sqliteTable("review_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  requestedByMembershipId: text("requested_by_membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  reviewerMembershipId: text("reviewer_membership_id").references(() => memberships.id, { onDelete: "restrict" }),
  resolution: text("resolution"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
}, (table) => [
  check("review_requests_status_check", sql`${table.status} IN ('open', 'reviewing', 'upheld', 'adjusted', 'rejected', 'withdrawn')`),
  index("idx_review_requests_organization_status").on(table.organizationId, table.status),
  index("idx_review_requests_object").on(table.objectType, table.objectId),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  actorMembershipId: text("actor_membership_id").references(() => memberships.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  reason: text("reason"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_audit_events_organization_created_at").on(table.organizationId, table.createdAt),
  index("idx_audit_events_object").on(table.objectType, table.objectId),
  index("idx_audit_events_actor_created_at").on(table.actorMembershipId, table.createdAt),
]);
