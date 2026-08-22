import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminAuthRequest } from "../server/admin-auth-http.ts";

function mutation(path, body, headers = {}) {
  return new Request(`https://equipo.example${path}`, {
    method: "POST",
    headers: { origin: "https://equipo.example", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides = {}) {
  const { repository: repositoryOverrides = {}, ...dependencyOverrides } = overrides;
  return {
    repository: {
      async getBootstrapState() { return { allowed: true, organizationId: null }; },
      async saveBootstrap() { return { created: true }; },
      async findLoginAccount() { return null; },
      async saveSession() {},
      async createManagedUser() { return { created: true }; },
      async recoverAdministratorPassword() { return { updated: true }; },
      async findSessionActor() { return null; },
      async revokeSession() {},
      async listOrganizationUsers() { return []; },
      ...repositoryOverrides,
    },
    createId: (() => { let id = 0; return () => `id-${++id}`; })(),
    createToken: () => "private-cookie-token",
    hashPassword: async () => "password-hash",
    verifyPassword: async () => true,
    hashToken: async () => "token-hash",
    setupAccessConfigured: true,
    verifySetupAccessKey: async () => false,
    createSetupGrant: async () => "signed-setup-grant",
    verifySetupGrant: async () => false,
    createRecoveryGrant: async () => "signed-recovery-grant",
    verifyRecoveryGrant: async () => false,
    now: () => "2026-08-22T12:00:00.000Z",
    ...dependencyOverrides,
  };
}

test("one-time activation creates the account and requires a separate login", async () => {
  const response = await handleAdminAuthRequest(mutation("/api/auth/bootstrap", {
    organizationName: "Restaurante",
    displayName: "Encargado",
    loginIdentifier: "jefe",
    password: "Una contraseña privada 2026",
  }, { cookie: "estrellas_setup=signed-setup-grant" }), dependencies({ verifySetupGrant: async () => true }));

  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /^estrellas_setup=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/);
  assert.deepEqual(await response.json(), { ok: true, displayName: "Encargado", role: "admin" });
});

test("unlocks recovery only after bootstrap is closed and completes it with a scoped cookie", async () => {
  const closed = { async getBootstrapState() { return { allowed: false, organizationId: null }; } };
  const unlocked = await handleAdminAuthRequest(
    mutation("/api/auth/recovery/unlock", { accessKey: "clave-correcta-y-unica-2026" }),
    dependencies({ repository: closed, verifySetupAccessKey: async () => true }),
  );
  const completed = await handleAdminAuthRequest(
    mutation("/api/auth/recovery/complete", { loginIdentifier: "jefe", newPassword: "Nueva contraseña privada 2026" }, { cookie: "estrellas_recovery=signed-recovery-grant" }),
    dependencies({ repository: closed, verifyRecoveryGrant: async () => true }),
  );

  assert.equal(unlocked.status, 200);
  assert.match(unlocked.headers.get("set-cookie"), /^estrellas_recovery=signed-recovery-grant; Path=\/; HttpOnly; SameSite=Strict; Max-Age=600; Secure$/);
  assert.equal(completed.status, 200);
  assert.match(completed.headers.get("set-cookie"), /^estrellas_recovery=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/);
  assert.deepEqual(await completed.json(), { ok: true });
});

test("rejects recovery without its temporary grant", async () => {
  const response = await handleAdminAuthRequest(
    mutation("/api/auth/recovery/complete", { loginIdentifier: "jefe", newPassword: "Nueva contraseña privada 2026" }),
    dependencies({ repository: { async getBootstrapState() { return { allowed: false, organizationId: null }; } } }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "recovery_access_required" });
});

test("status exposes bootstrap state but never password hashes or session tokens", async () => {
  const response = await handleAdminAuthRequest(
    new Request("https://equipo.example/api/auth/status"),
    dependencies(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, bootstrapAllowed: true, setupUnlocked: false, account: null, users: [] });
});

test("unlocks administrator registration with the unique key for ten minutes", async () => {
  const rejected = await handleAdminAuthRequest(
    mutation("/api/auth/bootstrap/unlock", { accessKey: "clave-incorrecta-pero-larga" }),
    dependencies(),
  );
  const accepted = await handleAdminAuthRequest(
    mutation("/api/auth/bootstrap/unlock", { accessKey: "clave-correcta-y-unica-2026" }),
    dependencies({ verifySetupAccessKey: async () => true }),
  );

  assert.equal(rejected.status, 401);
  assert.deepEqual(await rejected.json(), { ok: false, error: "invalid_access_key" });
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get("set-cookie"), /^estrellas_setup=signed-setup-grant; Path=\/; HttpOnly; SameSite=Strict; Max-Age=600; Secure$/);
  assert.deepEqual(await accepted.json(), { ok: true, setupUnlocked: true });
});

test("blocks administrator registration when no temporary setup grant is present", async () => {
  const response = await handleAdminAuthRequest(mutation("/api/auth/bootstrap", {
    organizationName: "Restaurante",
    displayName: "Encargado",
    loginIdentifier: "jefe",
    password: "Una contraseña privada 2026",
  }), dependencies());

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "setup_access_required" });
});

test("creating users requires a valid administrator session cookie", async () => {
  const input = { displayName: "Garzón 1", loginIdentifier: "garzon.1", password: "Clave privada del garzón", jobTitle: "waiter", tipPercentage: "100" };
  const unauthorized = await handleAdminAuthRequest(mutation("/api/admin/users", input), dependencies());
  const authorized = await handleAdminAuthRequest(
    mutation("/api/admin/users", input, { cookie: "estrellas_session=private-cookie-token" }),
    dependencies({ repository: { async findSessionActor() { return { userId: "u1", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m1" }; } } }),
  );

  assert.equal(unauthorized.status, 401);
  assert.equal(authorized.status, 201);
  assert.deepEqual(await authorized.json(), { ok: true, userId: "id-1", displayName: "Garzón 1" });
});

test("cross-origin mutations are rejected before account changes", async () => {
  const response = await handleAdminAuthRequest(
    mutation("/api/auth/login", { loginIdentifier: "jefe", password: "secret" }, { origin: "https://evil.example" }),
    dependencies(),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "cross_origin_request" });
});
