import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapAdministrator,
  createManagedUser,
  loginWithPassword,
  recoverAdministratorPassword,
} from "../server/admin-auth-service.ts";

const bootstrapInput = {
  organizationName: "Restaurante del equipo",
  displayName: "Encargado de salón",
  loginIdentifier: "jefe.salón",
  password: "Una contraseña larga y privada 2026",
};

function dependencies(overrides = {}) {
  const saved = { bootstrap: [], sessions: [], users: [], recoveries: [] };
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
