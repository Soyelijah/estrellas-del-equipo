import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { D1EvaluationRepository } from "../server/d1-evaluation-repository.ts";
import { D1AdminAuthRepository } from "../server/d1-admin-auth-repository.ts";

const drizzleDirectory = new URL("../drizzle/", import.meta.url);

class SQLiteD1Statement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new SQLiteD1Statement(this.database, this.sql, parameters);
  }

  async all() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.parameters),
    };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) ?? null;
  }

  async run() {
    this.database.prepare(this.sql).run(...this.parameters);
    return { success: true };
  }
}

class SQLiteD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SQLiteD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(drizzleDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();
  for (const migration of migrations) {
    database.exec(readFileSync(new URL(migration, drizzleDirectory), "utf8"));
  }

  database.exec(`
    INSERT INTO organizations (id, name, timezone, status)
    VALUES ('restaurant-1', 'Restaurante', 'America/Santiago', 'active');
    INSERT INTO users (id, login_identifier, auth_subject, display_name, status)
    VALUES
      ('user-rater', 'garzon1', 'site-user-123', 'Garzón 1', 'active'),
      ('user-subject', 'garzon2', 'site-user-456', 'Garzón 2', 'active');
    INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at)
    VALUES
      ('membership-rater', 'restaurant-1', 'user-rater', 'worker', 'waiter', '2026-08-01T00:00:00.000Z'),
      ('membership-subject', 'restaurant-1', 'user-subject', 'worker', 'waiter', '2026-08-01T00:00:00.000Z');
    INSERT INTO policy_versions (id, organization_id, version, effective_from, status, minimum_raters, minimum_shifts, created_by_membership_id)
    VALUES ('policy-1', 'restaurant-1', 1, '2026-08-01T00:00:00.000Z', 'active', 3, 3, 'membership-rater');
    INSERT INTO criteria (id, policy_version_id, code, name, description, category, applicable_job_title, measurement_type, weight_basis_points)
    VALUES
      ('criterion-teamwork', 'policy-1', 'teamwork', 'Trabajo en equipo', 'Coopera', 'teamwork', NULL, 'peer_rating', 5000),
      ('criterion-knowledge', 'policy-1', 'knowledge', 'Carta', 'Conoce la carta', 'knowledge', 'waiter', 'peer_rating', 5000);
    INSERT INTO evaluation_periods (id, organization_id, policy_version_id, name, starts_at, ends_at, status)
    VALUES ('period-1', 'restaurant-1', 'policy-1', 'Agosto', '2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.000Z', 'open');
    INSERT INTO evaluation_participations (id, period_id, membership_id, can_evaluate, can_be_evaluated)
    VALUES
      ('participation-rater', 'period-1', 'membership-rater', 1, 1),
      ('participation-subject', 'period-1', 'membership-subject', 1, 1);
    INSERT INTO shifts (id, organization_id, starts_at, ends_at, section, status)
    VALUES ('shift-1', 'restaurant-1', '2026-08-15T18:00:00.000Z', '2026-08-16T02:00:00.000Z', 'salon', 'closed');
    INSERT INTO shift_assignments (id, shift_id, membership_id, role_during_shift)
    VALUES
      ('assignment-rater', 'shift-1', 'membership-rater', 'waiter'),
      ('assignment-subject', 'shift-1', 'membership-subject', 'waiter');
  `);

  return {
    database,
    repository: new D1EvaluationRepository(new SQLiteD1Database(database)),
  };
}

function createEmptyAdminFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(drizzleDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();
  for (const migration of migrations) database.exec(readFileSync(new URL(migration, drizzleDirectory), "utf8"));
  return { database, repository: new D1AdminAuthRepository(new SQLiteD1Database(database)) };
}

test("persists a one-time administrator, its hashed session, and managed users atomically", async () => {
  const { database, repository } = createEmptyAdminFixture();
  assert.deepEqual(await repository.getBootstrapState(), { allowed: true, organizationId: null });

  const created = await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "stored-password-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });

  assert.deepEqual(created, { created: true });
  assert.deepEqual(await repository.getBootstrapState(), { allowed: false, organizationId: null });
  assert.equal(database.prepare("SELECT password_hash FROM users WHERE id = 'admin-1'").get().password_hash, "stored-password-hash");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 0);

  assert.deepEqual(await repository.createManagedUser({
    user: { id: "worker-1", authSubject: "local:worker-1", displayName: "Garzón 1", loginIdentifier: "garzon.1", passwordHash: "worker-password-hash", jobTitle: "waiter", status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
    membership: { id: "membership-worker", organizationId: "org-1", userId: "worker-1", role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: 65 },
  }), { created: true });
  assert.deepEqual((await repository.listOrganizationUsers("org-1")).map((user) => ({ ...user })), [{ id: "worker-1", displayName: "Garzón 1", loginIdentifier: "garzon.1", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 65 }]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'user.created'").get().count, 1);
});

test("recovers the administrator password atomically, revokes sessions, and records no secret", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "old-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  await repository.saveSession({ id: "session-1", userId: "admin-1", tokenHash: "session-hash", expiresAt: "2026-08-23T00:00:00.000Z", createdAt: "2026-08-22T12:00:00.000Z" });

  assert.deepEqual(await repository.recoverAdministratorPassword({ loginIdentifier: "jefe", passwordHash: "new-hash", auditId: "audit-recovery", now: "2026-08-22T13:00:00.000Z" }), { updated: true });
  assert.equal(database.prepare("SELECT password_hash FROM users WHERE id = 'admin-1'").get().password_hash, "new-hash");
  assert.equal(database.prepare("SELECT revoked_at FROM auth_sessions WHERE id = 'session-1'").get().revoked_at, "2026-08-22T13:00:00.000Z");
  const audit = database.prepare("SELECT action, actor_membership_id, metadata_json FROM audit_events WHERE id = 'audit-recovery'").get();
  assert.deepEqual({ ...audit }, { action: "admin.password_recovered", actor_membership_id: null, metadata_json: "{}" });
  assert.deepEqual(await repository.recoverAdministratorPassword({ loginIdentifier: "otro", passwordHash: "x", auditId: "audit-x", now: "2026-08-22T13:00:00.000Z" }), { updated: false });
});

test("loads the active membership bound to the authenticated subject", async () => {
  const { repository } = createFixture();

  const context = await repository.findAuthorizationContext("site-user-123");

  assert.equal(context.user.id, "user-rater");
  assert.equal(context.user.authSubject, "site-user-123");
  assert.equal(context.membership.id, "membership-rater");
  assert.equal(context.organization.id, "restaurant-1");
});

test("derives evaluation evidence from period participation and shared shifts", async () => {
  const { repository } = createFixture();

  const evidence = await repository.findSubmissionEvidence(
    {
      userId: "user-rater",
      membershipId: "membership-rater",
      organizationId: "restaurant-1",
      role: "worker",
    },
    {
      periodId: "period-1",
      shiftId: "shift-1",
      subjectMembershipId: "membership-subject",
      ratings: [],
    },
  );

  assert.deepEqual(evidence, {
    subjectOrganizationId: "restaurant-1",
    sharedShift: true,
    periodOpen: true,
    alreadySubmitted: false,
    raterCanEvaluate: true,
    subjectCanBeEvaluated: true,
    validCriterionIds: ["criterion-knowledge", "criterion-teamwork"],
  });
});

test("stores a submission and all observations atomically, then rejects its duplicate", async () => {
  const { database, repository } = createFixture();
  const record = {
    submission: {
      id: "submission-1",
      organizationId: "restaurant-1",
      periodId: "period-1",
      shiftId: "shift-1",
      raterMembershipId: "membership-rater",
      subjectMembershipId: "membership-subject",
      submittedAt: "2026-08-15T22:00:00.000Z",
    },
    observations: [
      { id: "observation-1", criterionId: "criterion-teamwork", responseStatus: "rated", value: 5 },
      { id: "observation-2", criterionId: "criterion-knowledge", responseStatus: "not_observed", value: null },
    ],
  };

  assert.deepEqual(await repository.saveSubmission(record), { created: true });
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM rating_observations").get().count,
    2,
  );
  assert.deepEqual(
    { ...database.prepare("SELECT response_status, value FROM rating_observations WHERE id = 'observation-2'").get() },
    { response_status: "not_observed", value: null },
  );
  assert.deepEqual(
    await repository.saveSubmission({
      ...record,
      submission: { ...record.submission, id: "submission-2" },
    }),
    { created: false, reason: "duplicate_submission" },
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM evaluation_submissions").get().count,
    1,
  );
});
