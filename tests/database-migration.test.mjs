import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const drizzleDirectory = new URL("../drizzle/", import.meta.url);

function foundationMigrationPaths() {
  const upFiles = readdirSync(drizzleDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();

  assert.ok(upFiles.length > 0, "expected at least one foundation migration");

  return upFiles.map((upName) => ({
    up: new URL(upName, drizzleDirectory),
    down: new URL(upName.replace(/\.sql$/, ".sql.rollback"), drizzleDirectory),
  }));
}

test("foundation migration creates the integrity-critical tables", () => {
  const migrationPaths = foundationMigrationPaths();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of migrationPaths) {
    database.exec(readFileSync(paths.up, "utf8"));
  }

  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);

  assert.deepEqual(tables, [
    "audit_events",
    "auth_sessions",
    "bootstrap_guards",
    "criteria",
    "evaluation_participations",
    "evaluation_periods",
    "evaluation_submissions",
    "integrity_alerts",
    "memberships",
    "organizations",
    "policy_versions",
    "rating_observations",
    "result_snapshots",
    "review_requests",
    "shift_assignments",
    "shifts",
    "tip_agreement_participants",
    "tip_agreements",
    "user_profiles",
    "users",
  ]);
});

test("user profiles store optional private contact data and a bounded avatar", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of foundationMigrationPaths()) database.exec(readFileSync(paths.up, "utf8"));

  database.exec("INSERT INTO users (id, login_identifier, display_name, status) VALUES ('u1', 'garzon', 'Garzón', 'active')");
  const insert = database.prepare(`
    INSERT INTO user_profiles (user_id, email, phone, bio, hired_on, avatar_mime_type, avatar_base64)
    VALUES ('u1', ?, ?, ?, '2026-08-25', 'image/webp', ?)
  `);
  insert.run("garzon@example.com", "+56912345678", "Servicio de salón", "YQ==");
  assert.throws(
    () => database.exec("UPDATE user_profiles SET avatar_mime_type = 'image/svg+xml' WHERE user_id = 'u1'"),
    /CHECK constraint failed: user_profiles_avatar_mime_check/,
  );
  database.exec("DELETE FROM users WHERE id = 'u1'");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM user_profiles").get().count, 0);
});

test("a total reset can remove the tenant before deleting users and reopening bootstrap", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of foundationMigrationPaths()) database.exec(readFileSync(paths.up, "utf8"));
  database.exec(`
    INSERT INTO organizations (id, name) VALUES ('o1', 'Restaurante');
    INSERT INTO users (id, login_identifier, display_name, status) VALUES ('u1', 'admin', 'Administrador', 'active');
    INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at) VALUES ('m1', 'o1', 'u1', 'admin', 'head_waiter', '2026-08-25');
    INSERT INTO user_profiles (user_id, email, updated_by_membership_id) VALUES ('u1', 'admin@example.com', 'm1');
    INSERT INTO bootstrap_guards (key) VALUES ('administrator_bootstrap');
    DELETE FROM organizations;
    DELETE FROM users;
    DELETE FROM bootstrap_guards;
  `);
  for (const table of ["organizations", "memberships", "users", "user_profiles", "bootstrap_guards"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} must be empty`);
  }
});

test("authentication migration stores only unique session hashes and a one-time bootstrap guard", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of foundationMigrationPaths()) database.exec(readFileSync(paths.up, "utf8"));

  const sessionColumns = database.prepare("PRAGMA table_info(auth_sessions)").all().map(({ name }) => name);
  assert.deepEqual(sessionColumns, ["id", "user_id", "token_hash", "expires_at", "created_at", "revoked_at"]);

  database.exec("INSERT INTO users (id, login_identifier, display_name, status) VALUES ('u1', 'jefe', 'Jefe', 'active')");
  const insertSession = database.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, 'u1', 'same-hash', '2026-08-22T20:00:00.000Z')");
  insertSession.run("s1");
  assert.throws(() => insertSession.run("s2"), /UNIQUE constraint failed: auth_sessions\.token_hash/);

  database.exec("INSERT INTO bootstrap_guards (key) VALUES ('administrator_bootstrap')");
  assert.throws(
    () => database.exec("INSERT INTO bootstrap_guards (key) VALUES ('administrator_bootstrap')"),
    /UNIQUE constraint failed: bootstrap_guards\.key/,
  );
});

test("memberships store an optional agreed tip factor between one and one hundred hundredths", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of foundationMigrationPaths()) database.exec(readFileSync(paths.up, "utf8"));
  const columns = database.prepare("PRAGMA table_info(memberships)").all().map(({ name }) => name);
  assert.ok(columns.includes("tip_factor_hundredths"));

  database.exec("INSERT INTO organizations (id, name, timezone, status) VALUES ('o1', 'Restaurante', 'America/Santiago', 'active')");
  database.exec("INSERT INTO users (id, login_identifier, display_name, status) VALUES ('u1', 'garzon', 'Garzón', 'active')");
  const insert = database.prepare("INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at, tip_factor_hundredths) VALUES ('m1', 'o1', 'u1', 'worker', 'waiter', '2026-08-22', ?)");
  insert.run(65);
  database.exec("DELETE FROM memberships WHERE id = 'm1'");
  assert.throws(() => insert.run(101), /CHECK constraint failed: memberships_tip_factor_check/);
});

test("foundation rollback removes every product table in reverse order", () => {
  const migrationPaths = foundationMigrationPaths();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");

  for (const paths of migrationPaths) {
    database.exec(readFileSync(paths.up, "utf8"));
  }
  for (const paths of [...migrationPaths].reverse()) {
    database.exec(readFileSync(paths.down, "utf8"));
  }

  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();

  assert.deepEqual(tables, []);
});

test("tip agreements store experience factors in hundredths rather than ambiguous weights", () => {
  const migrationPaths = foundationMigrationPaths();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of migrationPaths) {
    database.exec(readFileSync(paths.up, "utf8"));
  }

  const columns = database
    .prepare("PRAGMA table_info(tip_agreement_participants)")
    .all()
    .map(({ name }) => name);

  assert.ok(columns.includes("factor_hundredths"));
  assert.ok(!columns.includes("weight_points"));
  assert.ok(!columns.includes("percentage_basis_points"));
});

test("users can be linked to one unique authenticated platform subject", () => {
  const migrationPaths = foundationMigrationPaths();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of migrationPaths) {
    database.exec(readFileSync(paths.up, "utf8"));
  }

  const columns = database
    .prepare("PRAGMA table_info(users)")
    .all()
    .map(({ name }) => name);
  assert.ok(columns.includes("auth_subject"));

  const insert = database.prepare(
    "INSERT INTO users (id, login_identifier, display_name, auth_subject, status) VALUES (?, ?, ?, ?, 'active')",
  );
  insert.run("user-1", "garzon1", "Garzón 1", "site-user-123");
  assert.throws(
    () => insert.run("user-2", "garzon2", "Garzón 2", "site-user-123"),
    /UNIQUE constraint failed: users\.auth_subject/,
  );
});

test("rating observations preserve explicit no-observation answers without scoring them", () => {
  const migrationPaths = foundationMigrationPaths();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of migrationPaths) {
    database.exec(readFileSync(paths.up, "utf8"));
  }

  const columns = database
    .prepare("PRAGMA table_info(rating_observations)")
    .all();
  const responseStatus = columns.find(({ name }) => name === "response_status");
  const value = columns.find(({ name }) => name === "value");

  assert.equal(responseStatus.notnull, 1);
  assert.equal(value.notnull, 0);

  database.exec(`
    INSERT INTO organizations (id, name, timezone, status) VALUES ('org-1', 'Restaurante', 'America/Santiago', 'active');
    INSERT INTO users (id, login_identifier, display_name, status) VALUES ('u1', 'uno', 'Uno', 'active'), ('u2', 'dos', 'Dos', 'active');
    INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at) VALUES ('m1', 'org-1', 'u1', 'worker', 'Garzón', '2026-08-01'), ('m2', 'org-1', 'u2', 'worker', 'Garzón', '2026-08-01');
    INSERT INTO policy_versions (id, organization_id, version, effective_from, status, minimum_raters, minimum_shifts, created_by_membership_id) VALUES ('policy-1', 'org-1', 1, '2026-08-01', 'active', 2, 1, 'm1');
    INSERT INTO evaluation_periods (id, organization_id, policy_version_id, name, starts_at, ends_at, status) VALUES ('period-1', 'org-1', 'policy-1', 'Agosto', '2026-08-01', '2026-08-31', 'open');
    INSERT INTO shifts (id, organization_id, starts_at, ends_at, section, status) VALUES ('shift-1', 'org-1', '2026-08-15T18:00:00Z', '2026-08-16T02:00:00Z', 'Salón', 'closed');
    INSERT INTO criteria (id, policy_version_id, code, name, description, category, measurement_type, weight_basis_points) VALUES ('criterion-1', 'policy-1', 'teamwork', 'Equipo', 'Colabora durante el turno', 'colaboracion', 'peer_rating', 2500);
    INSERT INTO evaluation_submissions (id, organization_id, period_id, shift_id, rater_membership_id, subject_membership_id, status, submitted_at) VALUES ('submission-1', 'org-1', 'period-1', 'shift-1', 'm1', 'm2', 'submitted', '2026-08-15');
  `);

  const insert = database.prepare(
    "INSERT INTO rating_observations (id, submission_id, criterion_id, response_status, value) VALUES (?, 'submission-1', 'criterion-1', ?, ?)",
  );
  insert.run("observation-1", "not_observed", null);
  assert.throws(
    () => insert.run("observation-2", "not_observed", 5),
    /CHECK constraint failed: rating_observations_response_check/,
  );
});

test("head waiter policy migration preserves evaluations while making the role non-evaluable", () => {
  const migrationPaths = foundationMigrationPaths();
  const policyMigration = migrationPaths.find(({ up }) => up.pathname.endsWith("0009_head_waiter_evaluation_policy.sql"));
  assert.ok(policyMigration);

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of migrationPaths) {
    if (paths !== policyMigration) database.exec(readFileSync(paths.up, "utf8"));
  }
  database.exec(`
    INSERT INTO organizations (id, name, timezone, status) VALUES ('org-policy', 'Restaurante', 'America/Santiago', 'active');
    INSERT INTO users (id, login_identifier, display_name, status) VALUES
      ('admin-policy', 'admin.policy', 'Administrador', 'active'),
      ('head-policy', 'jefe.policy', 'Jefe de garzones', 'active'),
      ('cashier-policy', 'cajera.policy', 'Cajera', 'active');
    INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at) VALUES
      ('membership-admin-policy', 'org-policy', 'admin-policy', 'admin', 'head_waiter', '2026-08-01'),
      ('membership-head-policy', 'org-policy', 'head-policy', 'worker', 'head_waiter', '2026-08-01'),
      ('membership-cashier-policy', 'org-policy', 'cashier-policy', 'worker', 'cashier', '2026-08-01');
    INSERT INTO policy_versions (id, organization_id, version, effective_from, status, minimum_raters, minimum_shifts, created_by_membership_id)
      VALUES ('policy-role', 'org-policy', 1, '2026-08-01', 'active', 2, 1, 'membership-admin-policy');
    INSERT INTO evaluation_periods (id, organization_id, policy_version_id, name, starts_at, ends_at, status)
      VALUES ('period-role', 'org-policy', 'policy-role', 'Agosto', '2026-08-01', '2026-08-31', 'open');
    INSERT INTO evaluation_participations (id, period_id, membership_id, can_evaluate, can_be_evaluated, exclusion_reason) VALUES
      ('participation-head-policy', 'period-role', 'membership-head-policy', 1, 1, NULL),
      ('participation-cashier-policy', 'period-role', 'membership-cashier-policy', 1, 0, 'fixed_tip_share');
  `);

  database.exec(readFileSync(policyMigration.up, "utf8"));
  assert.deepEqual({ ...database.prepare("SELECT can_evaluate, can_be_evaluated, exclusion_reason FROM evaluation_participations WHERE id = 'participation-head-policy'").get() }, {
    can_evaluate: 1,
    can_be_evaluated: 0,
    exclusion_reason: "head_waiter_excluded",
  });
  assert.deepEqual({ ...database.prepare("SELECT can_evaluate, can_be_evaluated, exclusion_reason FROM evaluation_participations WHERE id = 'participation-cashier-policy'").get() }, {
    can_evaluate: 1,
    can_be_evaluated: 0,
    exclusion_reason: "fixed_tip_share",
  });

  database.exec(readFileSync(policyMigration.down, "utf8"));
  assert.deepEqual({ ...database.prepare("SELECT can_evaluate, can_be_evaluated, exclusion_reason FROM evaluation_participations WHERE id = 'participation-head-policy'").get() }, {
    can_evaluate: 1,
    can_be_evaluated: 1,
    exclusion_reason: null,
  });
});

test("policy cleanup migration voids historical evaluations of excluded subjects without deleting evidence", () => {
  const migrationPaths = foundationMigrationPaths();
  const cleanupMigration = migrationPaths.find(({ up }) => up.pathname.endsWith("0010_void_ineligible_evaluation_history.sql"));
  assert.ok(cleanupMigration);
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const paths of migrationPaths) {
    if (paths !== cleanupMigration) database.exec(readFileSync(paths.up, "utf8"));
  }
  database.exec(`
    INSERT INTO organizations (id, name, timezone, status) VALUES ('org-cleanup', 'Restaurante', 'America/Santiago', 'active');
    INSERT INTO users (id, login_identifier, display_name, status) VALUES ('rater-cleanup', 'garzon.cleanup', 'Garzón', 'active'), ('head-cleanup', 'jefe.cleanup', 'Jefe de garzones', 'active');
    INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at) VALUES ('membership-rater-cleanup', 'org-cleanup', 'rater-cleanup', 'worker', 'waiter', '2026-08-01'), ('membership-head-cleanup', 'org-cleanup', 'head-cleanup', 'worker', 'head_waiter', '2026-08-01');
    INSERT INTO policy_versions (id, organization_id, version, effective_from, status, minimum_raters, minimum_shifts, created_by_membership_id) VALUES ('policy-cleanup', 'org-cleanup', 1, '2026-08-01', 'active', 2, 1, 'membership-head-cleanup');
    INSERT INTO evaluation_periods (id, organization_id, policy_version_id, name, starts_at, ends_at, status) VALUES ('period-cleanup', 'org-cleanup', 'policy-cleanup', 'Agosto', '2026-08-01', '2026-08-31', 'open');
    INSERT INTO evaluation_participations (id, period_id, membership_id, can_evaluate, can_be_evaluated, exclusion_reason) VALUES ('participation-rater-cleanup', 'period-cleanup', 'membership-rater-cleanup', 1, 1, NULL), ('participation-head-cleanup', 'period-cleanup', 'membership-head-cleanup', 1, 0, 'head_waiter_excluded');
    INSERT INTO shifts (id, organization_id, period_id, starts_at, ends_at, section, status) VALUES ('shift-cleanup', 'org-cleanup', 'period-cleanup', '2026-08-24T18:00:00Z', '2026-08-25T02:00:00Z', 'Turno general', 'closed');
    INSERT INTO evaluation_submissions (id, organization_id, period_id, shift_id, rater_membership_id, subject_membership_id, status, submitted_at) VALUES ('submission-cleanup', 'org-cleanup', 'period-cleanup', 'shift-cleanup', 'membership-rater-cleanup', 'membership-head-cleanup', 'submitted', '2026-08-25T02:05:00Z');
    INSERT INTO criteria (id, policy_version_id, code, name, description, category, measurement_type, weight_basis_points) VALUES ('criterion-cleanup', 'policy-cleanup', 'teamwork', 'Equipo', 'Coopera', 'teamwork', 'peer_rating', 10000);
    INSERT INTO rating_observations (id, submission_id, criterion_id, response_status, value) VALUES ('observation-cleanup', 'submission-cleanup', 'criterion-cleanup', 'rated', 5);
  `);

  database.exec(readFileSync(cleanupMigration.up, "utf8"));
  assert.equal(database.prepare("SELECT status FROM evaluation_submissions WHERE id = 'submission-cleanup'").get().status, "voided");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rating_observations WHERE submission_id = 'submission-cleanup'").get().count, 1);
  database.exec(readFileSync(cleanupMigration.down, "utf8"));
  assert.equal(database.prepare("SELECT status FROM evaluation_submissions WHERE id = 'submission-cleanup'").get().status, "reopened");
});
