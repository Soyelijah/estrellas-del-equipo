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
  assert.deepEqual((await repository.listOrganizationUsers("org-1")).map((user) => ({ ...user })), [{ id: "worker-1", displayName: "Garzón 1", loginIdentifier: "garzon.1", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 65, email: null, phone: null, bio: null, hiredOn: null, hasAvatar: false }]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'user.created'").get().count, 1);
});

test("loads the session actor and organization users in one database snapshot", async () => {
  const { repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  await repository.createManagedUser({
    user: { id: "worker-1", authSubject: "local:worker-1", displayName: "Roberto", loginIdentifier: "roberto", passwordHash: "worker-hash", jobTitle: "waiter", status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
    membership: { id: "membership-worker", organizationId: "org-1", userId: "worker-1", role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: 65 },
  });
  await repository.saveSession({ id: "session-worker", userId: "worker-1", tokenHash: "session-hash", expiresAt: "2026-08-23T00:00:00.000Z", createdAt: "2026-08-22T13:00:00.000Z" });

  const snapshot = await repository.findSessionSnapshot("session-hash", "2026-08-22T14:00:00.000Z");
  assert.deepEqual(snapshot, {
    actor: { userId: "worker-1", displayName: "Roberto", role: "worker", organizationId: "org-1", membershipId: "membership-worker" },
    users: [{ id: "worker-1", displayName: "Roberto", loginIdentifier: "roberto", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 65, email: null, phone: null, bio: null, hiredOn: null, hasAvatar: false }],
  });
});

test("persists private profile fields and a profile photo without exposing image bytes in the user list", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  await repository.createManagedUser({
    user: { id: "worker-1", authSubject: "local:worker-1", displayName: "Roberto", loginIdentifier: "roberto", passwordHash: "worker-hash", jobTitle: "waiter", status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
    membership: { id: "membership-worker", organizationId: "org-1", userId: "worker-1", role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: 65 },
  });
  assert.deepEqual(await repository.updateUserProfile({ userId: "worker-1", organizationId: "org-1", actorMembershipId: "membership-admin", email: "roberto@example.com", phone: "+56912345678", bio: "Garzón de salón", hiredOn: "2026-08-25", auditId: "audit-profile", now: "2026-08-25T12:00:00.000Z" }), { updated: true });
  assert.deepEqual(await repository.updateUserAvatar({ userId: "worker-1", organizationId: "org-1", actorMembershipId: "membership-admin", mimeType: "image/webp", base64: "UklGRgAAAABXRUJQ", auditId: "audit-avatar", now: "2026-08-25T12:01:00.000Z" }), { updated: true });
  const users = await repository.listOrganizationUsers("org-1");
  assert.equal(users[0].email, "roberto@example.com");
  assert.equal(users[0].hasAvatar, true);
  assert.equal(JSON.stringify(users).includes("UklGRgAAAABXRUJQ"), false);
  assert.deepEqual({ ...await repository.findUserAvatar("worker-1", "org-1") }, { mimeType: "image/webp", base64: "UklGRgAAAABXRUJQ", updatedAt: "2026-08-25T12:01:00.000Z" });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action IN ('account.profile_updated', 'account.avatar_updated')").get().count, 2);
});

test("resets the single-tenant database and reopens administrator bootstrap", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  assert.deepEqual(await repository.resetSystem({ organizationId: "org-1" }), { reset: true });
  assert.deepEqual(await repository.getBootstrapState(), { allowed: true, organizationId: null });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0);
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

test("updates, suspends, reactivates, and resets only a worker in the administrators organization", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  await repository.createManagedUser({
    user: { id: "11111111-1111-4111-8111-111111111111", authSubject: "local:worker-1", displayName: "Garzón", loginIdentifier: "garzon", passwordHash: "old-worker-hash", jobTitle: "waiter", status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
    membership: { id: "membership-worker", organizationId: "org-1", userId: "11111111-1111-4111-8111-111111111111", role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: 65 },
  });
  await repository.saveSession({ id: "worker-session", userId: "11111111-1111-4111-8111-111111111111", tokenHash: "worker-session-hash", expiresAt: "2026-08-23T00:00:00.000Z", createdAt: "2026-08-22T13:00:00.000Z" });

  assert.deepEqual(await repository.updateManagedUser({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "org-1", actorMembershipId: "membership-admin", displayName: "Garzón Uno", loginIdentifier: "garzon.uno", jobTitle: "waiter", tipFactorHundredths: 75, auditId: "audit-update", now: "2026-08-22T14:00:00.000Z" }), { updated: true, conflict: false });
  assert.deepEqual(await repository.setManagedUserStatus({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "org-1", actorMembershipId: "membership-admin", status: "suspended", auditId: "audit-suspend", now: "2026-08-22T14:01:00.000Z" }), { updated: true });
  assert.deepEqual(await repository.setManagedUserStatus({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "org-1", actorMembershipId: "membership-admin", status: "active", auditId: "audit-reactivate", now: "2026-08-22T14:02:00.000Z" }), { updated: true });
  assert.deepEqual(await repository.resetManagedUserPassword({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "org-1", actorMembershipId: "membership-admin", passwordHash: "new-worker-hash", auditId: "audit-password", now: "2026-08-22T14:03:00.000Z" }), { updated: true });

  const worker = database.prepare("SELECT display_name, login_identifier, password_hash, status FROM users WHERE id = '11111111-1111-4111-8111-111111111111'").get();
  assert.deepEqual({ ...worker }, { display_name: "Garzón Uno", login_identifier: "garzon.uno", password_hash: "new-worker-hash", status: "active" });
  assert.equal(database.prepare("SELECT revoked_at FROM auth_sessions WHERE id = 'worker-session'").get().revoked_at, "2026-08-22T14:01:00.000Z");
  assert.deepEqual(database.prepare("SELECT action FROM audit_events WHERE id LIKE 'audit-%' ORDER BY created_at").all().map((row) => row.action), ["user.updated", "user.suspended", "user.reactivated", "user.password_reset"]);
  assert.deepEqual(await repository.setManagedUserStatus({ userId: "11111111-1111-4111-8111-111111111111", organizationId: "other-org", actorMembershipId: "membership-admin", status: "suspended", auditId: "audit-other", now: "2026-08-22T15:00:00.000Z" }), { updated: false });
});

test("soft-deletes a worker, removes private profile data, revokes access, and preserves its auditable identity", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  const userId = "11111111-1111-4111-8111-111111111111";
  await repository.createManagedUser({
    user: { id: userId, authSubject: "local:worker-delete", displayName: "Garzón", loginIdentifier: "garzon", passwordHash: "worker-hash", jobTitle: "waiter", status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
    membership: { id: "membership-worker", organizationId: "org-1", userId, role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: 65 },
  });
  await repository.updateUserProfile({ userId, organizationId: "org-1", actorMembershipId: "membership-admin", email: "privado@example.com", phone: null, bio: null, hiredOn: null, auditId: "audit-profile-delete", now: "2026-08-22T13:05:00.000Z" });
  await repository.saveSession({ id: "session-delete", userId, tokenHash: "token-delete", expiresAt: "2026-08-23T00:00:00.000Z", createdAt: "2026-08-22T13:00:00.000Z" });

  assert.deepEqual(await repository.deleteManagedUser({ userId, organizationId: "org-1", actorMembershipId: "membership-admin", confirmation: "otro", auditId: "audit-wrong", now: "2026-08-22T14:00:00.000Z" }), { deleted: false, confirmationMismatch: true });
  assert.deepEqual(await repository.deleteManagedUser({ userId, organizationId: "org-1", actorMembershipId: "membership-admin", confirmation: "garzon", auditId: "audit-delete", now: "2026-08-22T14:00:00.000Z" }), { deleted: true });
  const deleted = database.prepare("SELECT display_name, login_identifier, password_hash, status, deleted_at FROM users WHERE id = ?").get(userId);
  assert.deepEqual({ ...deleted }, { display_name: "Garzón", login_identifier: `eliminado-${userId}`, password_hash: null, status: "disabled", deleted_at: "2026-08-22T14:00:00.000Z" });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM user_profiles WHERE user_id = ?").get(userId).count, 0);
  assert.equal(database.prepare("SELECT revoked_at FROM auth_sessions WHERE id = 'session-delete'").get().revoked_at, "2026-08-22T14:00:00.000Z");
  assert.equal(database.prepare("SELECT action FROM audit_events WHERE id = 'audit-delete'").get().action, "user.deleted");
  assert.deepEqual(await repository.listOrganizationUsers("org-1"), []);
});

test("purges operational history while preserving users, memberships, profiles, factors, and sessions", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  await repository.createManagedUser({
    user: { id: "worker-1", authSubject: "local:worker-1", displayName: "Garzón", loginIdentifier: "garzon", passwordHash: "worker-hash", jobTitle: "waiter", status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
    membership: { id: "membership-worker", organizationId: "org-1", userId: "worker-1", role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: 65 },
  });
  await repository.updateUserProfile({ userId: "worker-1", organizationId: "org-1", actorMembershipId: "membership-admin", email: "garzon@example.com", phone: null, bio: null, hiredOn: null, auditId: "audit-profile-purge", now: "2026-08-22T13:05:00.000Z" });
  await repository.saveSession({ id: "session-purge", userId: "admin-1", tokenHash: "token-purge", expiresAt: "2026-08-23T00:00:00.000Z", createdAt: "2026-08-22T13:00:00.000Z" });
  database.exec(`
    INSERT INTO policy_versions (id, organization_id, version, effective_from, status, created_by_membership_id) VALUES ('policy-1','org-1',1,'2026-08-01','active','membership-admin');
    INSERT INTO criteria (id, policy_version_id, code, name, description, category, measurement_type, weight_basis_points) VALUES ('criterion-1','policy-1','discipline','Disciplina','Conducta','salon','peer_rating',10000);
    INSERT INTO evaluation_periods (id, organization_id, policy_version_id, name, starts_at, ends_at, status) VALUES ('period-1','org-1','policy-1','Agosto','2026-08-01','2026-09-01','open');
    INSERT INTO evaluation_participations (id, period_id, membership_id) VALUES ('participation-1','period-1','membership-worker');
    INSERT INTO shifts (id, organization_id, period_id, starts_at, ends_at, section, status) VALUES ('shift-1','org-1','period-1','2026-08-22T10:00:00Z','2026-08-22T18:00:00Z','general','closed');
    INSERT INTO shift_assignments (id, shift_id, membership_id, role_during_shift) VALUES ('assignment-1','shift-1','membership-worker','waiter');
  `);
  assert.deepEqual(await repository.purgeOperationalHistory({ organizationId: "org-1" }), { purged: true });
  for (const table of ["audit_events", "criteria", "evaluation_participations", "evaluation_periods", "policy_versions", "shift_assignments", "shifts", "tip_agreement_participants", "tip_agreements"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} must be empty`);
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM memberships").get().count, 2);
  assert.equal(database.prepare("SELECT tip_factor_hundredths FROM memberships WHERE id = 'membership-worker'").get().tip_factor_hundredths, 65);
  assert.equal(database.prepare("SELECT email FROM user_profiles WHERE user_id = 'worker-1'").get().email, "garzon@example.com");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM bootstrap_guards").get().count, 1);
});

test("lists sanitized audit events newest first and scoped to one organization", async () => {
  const { repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  await repository.createManagedUser({
    user: { id: "worker-1", authSubject: "local:worker-1", displayName: "Garzón", loginIdentifier: "garzon", passwordHash: "secret-hash", jobTitle: "waiter", status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
    membership: { id: "membership-worker", organizationId: "org-1", userId: "worker-1", role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: 65 },
  });
  const events = await repository.listAuditEvents("org-1", 50);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { id: events[0].id, action: "user.created", objectType: "user", objectId: "worker-1", reason: null, metadata: { jobTitle: "waiter" }, createdAt: "2026-08-22T13:00:00.000Z", actorDisplayName: "Jefe" });
  assert.equal(JSON.stringify(events).includes("secret-hash"), false);
  assert.deepEqual(await repository.listAuditEvents("other-org", 50), []);
});

test("opens a real cycle, records a shared shift, and applies the cashier participation agreement", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-1", name: "Restaurante", createdAt: "2026-08-22T12:00:00.000Z" },
    user: { id: "admin-1", authSubject: "local:admin-1", displayName: "Jefe", loginIdentifier: "jefe", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-22T12:00:00.000Z" },
    membership: { id: "membership-admin", organizationId: "org-1", userId: "admin-1", role: "admin", joinedAt: "2026-08-22T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-22T12:00:00.000Z" },
  });
  for (const worker of [
    { id: "worker-waiter", membershipId: "membership-waiter", displayName: "Garzón", login: "garzon", jobTitle: "waiter", factor: 100 },
    { id: "worker-cashier", membershipId: "membership-cashier", displayName: "Cajera", login: "cajera", jobTitle: "cashier", factor: 50 },
  ]) {
    await repository.createManagedUser({
      user: { id: worker.id, authSubject: `local:${worker.id}`, displayName: worker.displayName, loginIdentifier: worker.login, passwordHash: "hash", jobTitle: worker.jobTitle, status: "active", createdAt: "2026-08-22T13:00:00.000Z" },
      membership: { id: worker.membershipId, organizationId: "org-1", userId: worker.id, role: "worker", joinedAt: "2026-08-22T13:00:00.000Z", createdByMembershipId: "membership-admin", tipFactorHundredths: worker.factor },
    });
  }

  assert.deepEqual(await repository.openEvaluationCycle({
    organizationId: "org-1", createdByMembershipId: "membership-admin", policyId: "policy-real", periodId: "period-real", auditId: "audit-cycle", name: "Ciclo real", startsAt: "2026-08-22T00:00:00.000Z", endsAt: "2026-09-23T23:59:59.000Z", now: "2026-08-23T00:00:00.000Z",
    criteria: [
      { id: "criterion-a", code: "teamwork", name: "Equipo", description: "Coopera", category: "teamwork", weightBasisPoints: 5000 },
      { id: "criterion-b", code: "knowledge", name: "Carta", description: "Conoce", category: "knowledge", weightBasisPoints: 5000 },
    ],
  }), { created: true });
  assert.deepEqual(await repository.createEvaluationShift({
    id: "shift-real", auditId: "audit-shift", organizationId: "org-1", createdByMembershipId: "membership-admin", section: "Salón", startsAt: "2026-08-22T18:00:00.000Z", endsAt: "2026-08-23T02:00:00.000Z", membershipIds: ["membership-waiter", "membership-cashier"], now: "2026-08-23T03:00:00.000Z",
  }), { created: true });
  assert.deepEqual(await repository.createEvaluationShift({
    id: "shift-missing", auditId: "audit-shift-missing", organizationId: "org-1", createdByMembershipId: "membership-admin", section: "Salón", startsAt: "2026-08-23T18:00:00.000Z", endsAt: "2026-08-24T02:00:00.000Z", membershipIds: ["membership-waiter", "membership-cashier"], now: "2026-08-24T03:00:00.000Z",
  }), { created: true });
  assert.deepEqual(await repository.createEvaluationShift({
    id: "shift-outside", auditId: "audit-shift-outside", organizationId: "org-1", createdByMembershipId: "membership-admin", section: "Salón", startsAt: "2026-09-24T18:00:00.000Z", endsAt: "2026-09-25T02:00:00.000Z", membershipIds: ["membership-waiter", "membership-cashier"], now: "2026-09-25T03:00:00.000Z",
  }), { created: false, reason: "shift_outside_cycle" });

  const participations = database.prepare("SELECT membership_id, can_evaluate, can_be_evaluated FROM evaluation_participations ORDER BY membership_id").all().map((row) => ({ ...row }));
  assert.deepEqual(participations, [
    { membership_id: "membership-cashier", can_evaluate: 1, can_be_evaluated: 0 },
    { membership_id: "membership-waiter", can_evaluate: 1, can_be_evaluated: 1 },
  ]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM shift_assignments").get().count, 4);

  const evaluationRepository = new D1EvaluationRepository(new SQLiteD1Database(database));
  const cashierWorkspace = await evaluationRepository.loadWorkspace({ userId: "worker-cashier", membershipId: "membership-cashier", organizationId: "org-1", role: "worker" }, "2026-08-23T03:00:00.000Z");
  const waiterWorkspace = await evaluationRepository.loadWorkspace({ userId: "worker-waiter", membershipId: "membership-waiter", organizationId: "org-1", role: "worker" }, "2026-08-23T03:00:00.000Z");
  assert.deepEqual(cashierWorkspace.assignments.map((assignment) => assignment.subjectDisplayName), ["Garzón", "Garzón"]);
  assert.deepEqual(waiterWorkspace.assignments, []);

  database.exec(`
    INSERT INTO evaluation_submissions (
      id, organization_id, period_id, shift_id, rater_membership_id, subject_membership_id, status, submitted_at
    ) VALUES (
      'submission-real', 'org-1', 'period-real', 'shift-real', 'membership-cashier', 'membership-waiter', 'submitted', '2026-08-23T03:10:00.000Z'
    );
    INSERT INTO rating_observations (id, submission_id, criterion_id, response_status, value, moderation_status)
    VALUES
      ('observation-a', 'submission-real', 'criterion-a', 'rated', 5, 'not_required'),
      ('observation-b', 'submission-real', 'criterion-b', 'rated', 4, 'not_required');
  `);

  const operations = await repository.getEvaluationOperations("org-1");
  assert.deepEqual(operations.summary, {
    periodId: "period-real",
    completedSubmissions: 1,
    expectedSubmissions: 2,
    completionPercent: 50,
    daily: [
      { serviceDate: "2026-08-22", completedSubmissions: 1, expectedSubmissions: 1 },
      { serviceDate: "2026-08-23", completedSubmissions: 0, expectedSubmissions: 1 },
    ],
    results: [{
      membershipId: "membership-waiter",
      displayName: "Garzón",
      jobTitle: "waiter",
      score: 4.5,
      actualScore: 4.5,
      estimatedDays: 1,
      unscoredDays: 0,
      dailyScores: [
        { serviceDate: "2026-08-22", actualScore: 4.5, score: 4.5, source: "actual" },
        { serviceDate: "2026-08-23", actualScore: null, score: 4.5, source: "estimated_previous_average" },
      ],
      evaluatedDays: 1,
      independentRaters: 1,
      completedSubmissions: 1,
      criteria: [
        { criterionId: "criterion-a", name: "Equipo", score: 5 },
        { criterionId: "criterion-b", name: "Carta", score: 4 },
      ],
    }],
  });

  assert.deepEqual(await repository.deleteEvaluationShift({
    shiftId: "shift-real", organizationId: "org-1", actorMembershipId: "membership-admin",
    auditId: "audit-protected-shift", reason: "No debe eliminar evaluaciones", now: "2026-08-24T03:30:00.000Z",
  }), { deleted: false, reason: "shift_has_evaluations" });

  assert.deepEqual(await repository.deleteEvaluationShift({
    shiftId: "shift-missing", organizationId: "org-1", actorMembershipId: "membership-admin",
    auditId: "audit-shift-delete", reason: "Turno registrado con fechas incorrectas", now: "2026-08-24T04:00:00.000Z",
  }), { deleted: true });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM shifts").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM shift_assignments WHERE shift_id = 'shift-missing'").get().count, 0);
  assert.deepEqual({ ...database.prepare("SELECT action, reason FROM audit_events WHERE id = 'audit-shift-delete'").get() }, { action: "evaluation.shift_deleted", reason: "Turno registrado con fechas incorrectas" });

  assert.deepEqual(await repository.closeEvaluationCycle({
    periodId: "period-real", organizationId: "org-1", actorMembershipId: "membership-admin",
    auditId: "audit-close", reason: "Cierre mensual revisado", now: "2026-09-24T00:00:00.000Z",
  }), { updated: true });
  assert.equal(database.prepare("SELECT status FROM evaluation_periods WHERE id = 'period-real'").get().status, "under_review");
  assert.deepEqual({ ...database.prepare("SELECT action, reason FROM audit_events WHERE id = 'audit-close'").get() }, { action: "evaluation.cycle_closed", reason: "Cierre mensual revisado" });
  assert.equal((await evaluationRepository.loadWorkspace({ userId: "worker-cashier", membershipId: "membership-cashier", organizationId: "org-1", role: "worker" }, "2026-08-23T03:00:00.000Z")).period, null);

  assert.deepEqual(await repository.deleteEvaluationCycle({
    periodId: "period-real", organizationId: "org-1", actorMembershipId: "membership-admin",
    auditId: "audit-delete", reason: "Reemplazo autorizado por el ciclo mensual oficial", now: "2026-09-24T00:05:00.000Z",
  }), { deleted: true });
  for (const table of ["evaluation_periods", "evaluation_participations", "shifts", "shift_assignments", "evaluation_submissions", "rating_observations", "criteria", "policy_versions"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} should be empty`);
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users").get().count, 3);
  assert.deepEqual(database.prepare("SELECT tip_factor_hundredths FROM memberships WHERE id = 'membership-cashier'").get().tip_factor_hundredths, 50);
  assert.deepEqual({ ...database.prepare("SELECT action, reason FROM audit_events WHERE id = 'audit-delete'").get() }, { action: "evaluation.cycle_deleted", reason: "Reemplazo autorizado por el ciclo mensual oficial" });

});

test("enforces the administrator, head waiter, waiter, and cashier evaluation matrix", async () => {
  const { database, repository } = createEmptyAdminFixture();
  await repository.saveBootstrap({
    organization: { id: "org-matrix", name: "Restaurante", createdAt: "2026-08-24T12:00:00.000Z" },
    user: { id: "admin-matrix", authSubject: "local:admin-matrix", displayName: "Administrador", loginIdentifier: "administrador", passwordHash: "admin-hash", status: "active", createdAt: "2026-08-24T12:00:00.000Z" },
    membership: { id: "membership-admin-matrix", organizationId: "org-matrix", userId: "admin-matrix", role: "admin", joinedAt: "2026-08-24T12:00:00.000Z" },
    guard: { key: "administrator_bootstrap", createdAt: "2026-08-24T12:00:00.000Z" },
  });

  for (const worker of [
    { id: "head-matrix", membershipId: "membership-head-matrix", displayName: "Jefe de garzones", login: "jefe.garzones", jobTitle: "head_waiter", factor: 100 },
    { id: "waiter-matrix", membershipId: "membership-waiter-matrix", displayName: "Garzón", login: "garzon.real", jobTitle: "waiter", factor: 65 },
    { id: "cashier-matrix", membershipId: "membership-cashier-matrix", displayName: "Cajera", login: "cajera.real", jobTitle: "cashier", factor: 50 },
  ]) {
    await repository.createManagedUser({
      user: { id: worker.id, authSubject: `local:${worker.id}`, displayName: worker.displayName, loginIdentifier: worker.login, passwordHash: "worker-hash", jobTitle: worker.jobTitle, status: "active", createdAt: "2026-08-24T12:10:00.000Z" },
      membership: { id: worker.membershipId, organizationId: "org-matrix", userId: worker.id, role: "worker", joinedAt: "2026-08-24T12:10:00.000Z", createdByMembershipId: "membership-admin-matrix", tipFactorHundredths: worker.factor },
    });
  }

  assert.deepEqual(await repository.openEvaluationCycle({
    organizationId: "org-matrix", createdByMembershipId: "membership-admin-matrix", policyId: "policy-matrix", periodId: "period-matrix", auditId: "audit-cycle-matrix", name: "Agosto 2026", startsAt: "2026-08-01T04:00:00.000Z", endsAt: "2026-09-01T03:59:59.000Z", now: "2026-08-24T12:20:00.000Z",
    criteria: [
      { id: "criterion-matrix", code: "teamwork", name: "Trabajo en equipo", description: "Colabora con el salón", category: "teamwork", weightBasisPoints: 10000 },
    ],
  }), { created: true });

  assert.deepEqual(await repository.createEvaluationShift({
    id: "shift-matrix", auditId: "audit-shift-matrix", organizationId: "org-matrix", createdByMembershipId: "membership-admin-matrix", section: "Salón", startsAt: "2026-08-24T18:00:00.000Z", endsAt: "2026-08-25T02:00:00.000Z", membershipIds: ["membership-head-matrix", "membership-waiter-matrix", "membership-cashier-matrix"], now: "2026-08-25T02:05:00.000Z",
  }), { created: true });

  const participations = database.prepare(`
    SELECT membership_id, can_evaluate, can_be_evaluated, exclusion_reason
    FROM evaluation_participations ORDER BY membership_id
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(participations, [
    { membership_id: "membership-cashier-matrix", can_evaluate: 1, can_be_evaluated: 0, exclusion_reason: "fixed_tip_share" },
    { membership_id: "membership-head-matrix", can_evaluate: 1, can_be_evaluated: 0, exclusion_reason: "head_waiter_excluded" },
    { membership_id: "membership-waiter-matrix", can_evaluate: 1, can_be_evaluated: 1, exclusion_reason: null },
  ]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evaluation_participations WHERE membership_id = 'membership-admin-matrix'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM shift_assignments WHERE shift_id = 'shift-matrix'").get().count, 3);

  const evaluationRepository = new D1EvaluationRepository(new SQLiteD1Database(database));
  const [headWorkspace, waiterWorkspace, cashierWorkspace] = await Promise.all([
    evaluationRepository.loadWorkspace({ userId: "head-matrix", membershipId: "membership-head-matrix", organizationId: "org-matrix", role: "worker" }, "2026-08-25T02:10:00.000Z"),
    evaluationRepository.loadWorkspace({ userId: "waiter-matrix", membershipId: "membership-waiter-matrix", organizationId: "org-matrix", role: "worker" }, "2026-08-25T02:10:00.000Z"),
    evaluationRepository.loadWorkspace({ userId: "cashier-matrix", membershipId: "membership-cashier-matrix", organizationId: "org-matrix", role: "worker" }, "2026-08-25T02:10:00.000Z"),
  ]);
  assert.deepEqual(headWorkspace.assignments.map((assignment) => assignment.subjectDisplayName), ["Garzón"]);
  assert.deepEqual(cashierWorkspace.assignments.map((assignment) => assignment.subjectDisplayName), ["Garzón"]);
  assert.deepEqual(waiterWorkspace.assignments, []);

  const operations = await repository.getEvaluationOperations("org-matrix");
  assert.deepEqual(operations.members.map(({ displayName, canEvaluate, canBeEvaluated }) => ({ displayName, canEvaluate, canBeEvaluated })), [
    { displayName: "Cajera", canEvaluate: true, canBeEvaluated: false },
    { displayName: "Garzón", canEvaluate: true, canBeEvaluated: true },
    { displayName: "Jefe de garzones", canEvaluate: true, canBeEvaluated: false },
  ]);

  database.exec(`
    INSERT INTO evaluation_submissions (id, organization_id, period_id, shift_id, rater_membership_id, subject_membership_id, status, submitted_at)
    VALUES ('55555555-5555-4555-8555-555555555555', 'org-matrix', 'period-matrix', 'shift-matrix', 'membership-head-matrix', 'membership-waiter-matrix', 'submitted', '2026-08-25T02:15:00.000Z');
    INSERT INTO rating_observations (id, submission_id, criterion_id, response_status, value, moderation_status)
    VALUES ('observation-matrix', '55555555-5555-4555-8555-555555555555', 'criterion-matrix', 'rated', 4, 'not_required');
  `);
  const history = (await repository.getEvaluationOperations("org-matrix")).submissions;
  assert.deepEqual(history.map(({ id, status, raterDisplayName, subjectDisplayName, score, responseCount }) => ({ id, status, raterDisplayName, subjectDisplayName, score, responseCount })), [{
    id: "55555555-5555-4555-8555-555555555555",
    status: "submitted",
    raterDisplayName: "Jefe de garzones",
    subjectDisplayName: "Garzón",
    score: 4,
    responseCount: 1,
  }]);
  assert.deepEqual(await repository.setEvaluationSubmissionStatus({
    submissionId: "55555555-5555-4555-8555-555555555555", organizationId: "org-matrix", actorMembershipId: "membership-admin-matrix", auditId: "audit-void-matrix", status: "voided", reason: "Evaluación anterior al acuerdo vigente", now: "2026-08-25T02:20:00.000Z",
  }), { updated: true });
  assert.equal(database.prepare("SELECT status FROM evaluation_submissions WHERE id = '55555555-5555-4555-8555-555555555555'").get().status, "voided");
  assert.deepEqual(await repository.setEvaluationSubmissionStatus({
    submissionId: "55555555-5555-4555-8555-555555555555", organizationId: "org-matrix", actorMembershipId: "membership-admin-matrix", auditId: "audit-restore-matrix", status: "reopened", reason: "Restauración revisada por administración", now: "2026-08-25T02:21:00.000Z",
  }), { updated: true });
  assert.deepEqual(await repository.voidEvaluationHistory({
    membershipId: "membership-waiter-matrix", organizationId: "org-matrix", actorMembershipId: "membership-admin-matrix", auditId: "audit-bulk-matrix", scope: "received", reason: "Corrección completa autorizada por administración", now: "2026-08-25T02:22:00.000Z",
  }), { updated: true, count: 1 });
  assert.equal(database.prepare("SELECT status FROM evaluation_submissions WHERE id = '55555555-5555-4555-8555-555555555555'").get().status, "voided");
  assert.deepEqual(database.prepare("SELECT action FROM audit_events WHERE id IN ('audit-void-matrix', 'audit-restore-matrix', 'audit-bulk-matrix') ORDER BY created_at").all().map((row) => row.action), ["evaluation.submission_voided", "evaluation.submission_restored", "evaluation.history_voided"]);
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
    "2026-08-15T20:00:00.000Z",
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

  const afterMonth = await repository.findSubmissionEvidence(
    { userId: "user-rater", membershipId: "membership-rater", organizationId: "restaurant-1", role: "worker" },
    { periodId: "period-1", shiftId: "shift-1", subjectMembershipId: "membership-subject", ratings: [] },
    "2026-09-01T00:00:00.000Z",
  );
  assert.equal(afterMonth.periodOpen, false);
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
      { id: "observation-1", criterionId: "criterion-teamwork", responseStatus: "rated", value: 5, evidenceNote: null },
      { id: "observation-2", criterionId: "criterion-knowledge", responseStatus: "not_observed", value: null, evidenceNote: "No compartimos esa tarea durante el turno." },
    ],
  };

  assert.deepEqual(await repository.saveSubmission(record), { created: true });
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM rating_observations").get().count,
    2,
  );
  assert.deepEqual(
    { ...database.prepare("SELECT response_status, value, evidence_note FROM rating_observations WHERE id = 'observation-2'").get() },
    { response_status: "not_observed", value: null, evidence_note: "No compartimos esa tarea durante el turno." },
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
