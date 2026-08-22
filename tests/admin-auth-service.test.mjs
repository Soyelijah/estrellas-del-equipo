import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapAdministrator,
  createManagedUser,
  loginWithPassword,
  recoverAdministratorPassword,
  resetManagedUserPassword,
  setManagedUserStatus,
  updateManagedUser,
} from "../server/admin-auth-service.ts";

const bootstrapInput = {
  organizationName: "Restaurante del equipo",
  displayName: "Encargado de salón",
  loginIdentifier: "jefe.salón",
  password: "Una contraseña larga y privada 2026",
};

function dependencies(overrides = {}) {
  const saved = { bootstrap: [], sessions: [], users: [], recoveries: [], updates: [], statuses: [], passwordResets: [] };
  let id = 0;
  return {
    saved,
    repository: {
      async getBootstrapState() { return { allowed: true, organizationId: null }; },
      async saveBootstrap(record) { saved.bootstrap.push(record); return { created: true }; },
      async findLoginAccount() { return null; },
      async saveSession(record) { saved.sessions.push(record); },
      async createManagedUser(record) { saved.users.push(record); return { created: true }; },
      async recoverAdministratorPassword(record) { saved.recoveries.push(record); return { updated: true }; },
      async updateManagedUser(record) { saved.updates.push(record); return { updated: true, conflict: false }; },
      async setManagedUserStatus(record) { saved.statuses.push(record); return { updated: true }; },
      async resetManagedUserPassword(record) { saved.passwordResets.push(record); return { updated: true }; },
      ...overrides.repository,
    },
    createId: () => `id-${++id}`,
    createToken: () => "opaque-session-token",
    hashPassword: async () => "stored-password-hash",
    verifyPassword: async (password, hash) => password === "valid-password" && hash === "stored-password-hash",
    hashToken: async () => "stored-token-hash",
    now: "2026-08-22T12:00:00.000Z",
  };
}

test("creates the only initial administrator without starting a session automatically", async () => {
  const deps = dependencies();
  const result = await bootstrapAdministrator(bootstrapInput, deps);

  assert.deepEqual(result, { ok: true, status: 201, displayName: "Encargado de salón", role: "admin" });
  assert.equal(deps.saved.bootstrap.length, 1);
  assert.equal(deps.saved.bootstrap[0].user.loginIdentifier, "jefe.salón");
  assert.equal(deps.saved.bootstrap[0].user.passwordHash, "stored-password-hash");
  assert.equal(JSON.stringify(deps.saved.bootstrap[0]).includes(bootstrapInput.password), false);
  assert.equal(deps.saved.bootstrap[0].membership.role, "admin");
  assert.equal("session" in deps.saved.bootstrap[0], false);
  assert.equal(deps.saved.sessions.length, 0);
});

test("recovers only the existing administrator and never passes the plain password to storage", async () => {
  const deps = dependencies();
  const accepted = await recoverAdministratorPassword({ loginIdentifier: " JEFE.SALÓN ", newPassword: "Nueva contraseña privada 2026" }, deps);
  const invalid = await recoverAdministratorPassword({ loginIdentifier: "x", newPassword: "corta" }, deps);

  assert.deepEqual(accepted, { ok: true, status: 200 });
  assert.deepEqual(invalid, { ok: false, status: 422, error: "invalid_recovery_data" });
  assert.equal(deps.saved.recoveries.length, 1);
  assert.equal(deps.saved.recoveries[0].loginIdentifier, "jefe.salón");
  assert.equal(deps.saved.recoveries[0].passwordHash, "stored-password-hash");
  assert.equal(JSON.stringify(deps.saved.recoveries[0]).includes("Nueva contraseña privada 2026"), false);
});

test("uses one generic recovery error when the administrator cannot be updated", async () => {
  const deps = dependencies({ repository: { async recoverAdministratorPassword() { return { updated: false }; } } });
  assert.deepEqual(
    await recoverAdministratorPassword({ loginIdentifier: "desconocido", newPassword: "Nueva contraseña privada 2026" }, deps),
    { ok: false, status: 401, error: "invalid_recovery" },
  );
});

test("closes bootstrap permanently once an administrator exists", async () => {
  const deps = dependencies({ repository: { async getBootstrapState() { return { allowed: false, organizationId: "org-1" }; } } });
  const result = await bootstrapAdministrator(bootstrapInput, deps);

  assert.deepEqual(result, { ok: false, status: 409, error: "bootstrap_closed" });
  assert.equal(deps.saved.bootstrap.length, 0);
});

test("validates administrator fields and a minimum twelve-character password", async () => {
  const deps = dependencies();
  const result = await bootstrapAdministrator({ ...bootstrapInput, loginIdentifier: "x", password: "corta" }, deps);

  assert.deepEqual(result, { ok: false, status: 422, error: "invalid_account_data" });
  assert.equal(deps.saved.bootstrap.length, 0);
});

test("logs in with one generic error and creates an opaque bounded session", async () => {
  const account = {
    userId: "user-1",
    authSubject: "local:user-1",
    displayName: "Encargado",
    loginIdentifier: "jefe",
    passwordHash: "stored-password-hash",
    status: "active",
    membershipId: "membership-1",
    organizationId: "org-1",
    role: "admin",
  };
  const deps = dependencies({ repository: { async findLoginAccount() { return account; } } });

  const accepted = await loginWithPassword({ loginIdentifier: " JEFE ", password: "valid-password" }, deps);
  const rejected = await loginWithPassword({ loginIdentifier: "jefe", password: "wrong" }, deps);

  assert.deepEqual(accepted, { ok: true, status: 200, sessionToken: "opaque-session-token", displayName: "Encargado", role: "admin" });
  assert.deepEqual(rejected, { ok: false, status: 401, error: "invalid_credentials" });
  assert.equal(deps.saved.sessions[0].tokenHash, "stored-token-hash");
  assert.equal(deps.saved.sessions[0].expiresAt, "2026-08-22T20:00:00.000Z");
});

test("allows only an administrator to create a real user account", async () => {
  const deps = dependencies();
  const input = { displayName: "Garzón principal", loginIdentifier: "garzon.1", password: "Otra contraseña privada 2026", jobTitle: "waiter", tipPercentage: "65" };

  const forbidden = await createManagedUser(input, { role: "worker", organizationId: "org-1", membershipId: "m-1" }, deps);
  const accepted = await createManagedUser(input, { role: "admin", organizationId: "org-1", membershipId: "m-admin" }, deps);

  assert.deepEqual(forbidden, { ok: false, status: 403, error: "admin_required" });
  assert.deepEqual(accepted, { ok: true, status: 201, userId: "id-1", displayName: "Garzón principal" });
  assert.equal(deps.saved.users[0].user.passwordHash, "stored-password-hash");
  assert.equal(deps.saved.users[0].membership.organizationId, "org-1");
  assert.equal(deps.saved.users[0].membership.createdByMembershipId, "m-admin");
  assert.equal(deps.saved.users[0].membership.tipFactorHundredths, 65);
});

test("rejects a worker percentage outside one to one hundred", async () => {
  const deps = dependencies();
  const actor = { role: "admin", organizationId: "org-1", membershipId: "m-admin" };
  const input = { displayName: "Garzón", loginIdentifier: "garzon", password: "Otra contraseña privada 2026", jobTitle: "waiter" };

  assert.deepEqual(await createManagedUser({ ...input, tipPercentage: "0" }, actor, deps), { ok: false, status: 422, error: "invalid_account_data" });
  assert.deepEqual(await createManagedUser({ ...input, tipPercentage: "101" }, actor, deps), { ok: false, status: 422, error: "invalid_account_data" });
  assert.deepEqual(await createManagedUser({ ...input, tipPercentage: "65.5" }, actor, deps), { ok: false, status: 422, error: "invalid_account_data" });
});

test("requires the cashier fixed factor to remain fifty", async () => {
  const deps = dependencies();
  const actor = { role: "admin", organizationId: "org-1", membershipId: "m-admin" };
  const input = { displayName: "Cajera", loginIdentifier: "cajera", password: "Otra contraseña privada 2026", jobTitle: "cashier" };
  assert.deepEqual(await createManagedUser({ ...input, tipPercentage: "75" }, actor, deps), { ok: false, status: 422, error: "invalid_account_data" });
  assert.equal((await createManagedUser({ ...input, tipPercentage: "50" }, actor, deps)).ok, true);
});

test("updates a managed worker only as administrator and normalizes real account data", async () => {
  const deps = dependencies();
  const input = { userId: "11111111-1111-4111-8111-111111111111", displayName: " Garzón Uno ", loginIdentifier: " GARZON.UNO ", jobTitle: "waiter", tipPercentage: "65" };
  const forbidden = await updateManagedUser(input, { role: "worker", organizationId: "org-1", membershipId: "m-worker" }, deps);
  const accepted = await updateManagedUser(input, { role: "admin", organizationId: "org-1", membershipId: "m-admin" }, deps);
  assert.deepEqual(forbidden, { ok: false, status: 403, error: "admin_required" });
  assert.deepEqual(accepted, { ok: true, status: 200 });
  assert.deepEqual(deps.saved.updates[0], { ...input, displayName: "Garzón Uno", loginIdentifier: "garzon.uno", tipFactorHundredths: 65, organizationId: "org-1", actorMembershipId: "m-admin", auditId: "id-1", now: deps.now });
});

test("maps worker update conflicts and missing cross-organization records safely", async () => {
  const actor = { role: "admin", organizationId: "org-1", membershipId: "m-admin" };
  const input = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Garzón", loginIdentifier: "garzon", jobTitle: "waiter", tipPercentage: 50 };
  const conflict = dependencies({ repository: { async updateManagedUser() { return { updated: false, conflict: true }; } } });
  const missing = dependencies({ repository: { async updateManagedUser() { return { updated: false, conflict: false }; } } });
  assert.deepEqual(await updateManagedUser(input, actor, conflict), { ok: false, status: 409, error: "login_identifier_exists" });
  assert.deepEqual(await updateManagedUser(input, actor, missing), { ok: false, status: 404, error: "managed_user_not_found" });
});

test("suspends and reactivates workers and resets credentials without retaining the password", async () => {
  const deps = dependencies();
  const actor = { role: "admin", organizationId: "org-1", membershipId: "m-admin" };
  const userId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(await setManagedUserStatus({ userId, status: "suspended" }, actor, deps), { ok: true, status: 200 });
  assert.deepEqual(await setManagedUserStatus({ userId, status: "active" }, actor, deps), { ok: true, status: 200 });
  assert.deepEqual(await resetManagedUserPassword({ userId, newPassword: "Credencial privada nueva 2026" }, actor, deps), { ok: true, status: 200 });
  assert.deepEqual(deps.saved.statuses.map((entry) => entry.status), ["suspended", "active"]);
  assert.equal(deps.saved.passwordResets[0].passwordHash, "stored-password-hash");
  assert.equal(JSON.stringify(deps.saved.passwordResets[0]).includes("Credencial privada nueva 2026"), false);
});
