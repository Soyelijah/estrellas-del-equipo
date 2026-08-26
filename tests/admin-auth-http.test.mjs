import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminAuthRequest } from "../server/admin-auth-http.ts";

function mutation(path, body, headers = {}, method = "POST") {
  return new Request(`https://equipo.example${path}`, {
    method,
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
      async updateManagedUser() { return { updated: true, conflict: false }; },
      async setManagedUserStatus() { return { updated: true }; },
      async deleteManagedUser() { return { deleted: true }; },
      async resetManagedUserPassword() { return { updated: true }; },
      async updateUserProfile() { return { updated: true }; },
      async updateUserAvatar() { return { updated: true }; },
      async findUserAvatar() { return null; },
      async findAdministratorCredential() { return { passwordHash: "password-hash" }; },
      async resetSystem() { return { reset: true }; },
      async purgeOperationalHistory() { return { purged: true }; },
      async findSessionActor() { return null; },
      async findSessionSnapshot() { return null; },
      async revokeSession() {},
      async listOrganizationUsers() { return []; },
      async listAuditEvents() { return []; },
      async getEvaluationOperations() { return { period: null, shifts: [], members: [] }; },
      async openEvaluationCycle() { return { created: true }; },
      async createEvaluationShift() { return { created: true }; },
      async deleteEvaluationShift() { return { deleted: true }; },
      async setEvaluationSubmissionStatus() { return { updated: true }; },
      async voidEvaluationHistory() { return { updated: true, count: 0 }; },
      async closeEvaluationCycle() { return { updated: true }; },
      async deleteEvaluationCycle() { return { deleted: true }; },
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
  assert.deepEqual(await response.json(), { ok: true, bootstrapAllowed: true, setupUnlocked: false, recoveryUnlocked: false, account: null, users: [], team: [] });
});

test("exposes a sanitized team to workers without other members' private data", async () => {
  const team = [
    { id: "u1", displayName: "Garzón", loginIdentifier: "garzon.privado", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 65, email: "garzon@example.com", phone: "+56911111111", bio: "Servicio de salón", hiredOn: "2024-01-01", hasAvatar: true },
    { id: "u2", displayName: "Compañera", loginIdentifier: "companera.privada", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 75, email: "companera@example.com", phone: "+56922222222", bio: "Servicio de barra", hiredOn: "2023-01-01", hasAvatar: false },
  ];
  const response = await handleAdminAuthRequest(new Request("https://equipo.example/api/auth/status", { headers: { cookie: "estrellas_session=private-cookie-token" } }), dependencies({ repository: {
    async findSessionSnapshot() { return { actor: { userId: "u1", displayName: "Garzón", role: "worker", organizationId: "o1", membershipId: "m1" }, users: team }; },
  } }));
  const body = await response.json();
  assert.deepEqual(body.users, []);
  assert.deepEqual(body.team, [
    { id: "u1", displayName: "Garzón", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 65, email: "garzon@example.com", phone: "+56911111111", bio: "Servicio de salón", hiredOn: "2024-01-01", hasAvatar: true },
    { id: "u2", displayName: "Compañera", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 75, email: null, phone: null, bio: null, hiredOn: null, hasAvatar: false },
  ]);
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("garzon.privado"), false);
  assert.equal(serialized.includes("companera.privada"), false);
  assert.equal(serialized.includes("companera@example.com"), false);
  assert.equal(serialized.includes("+56922222222"), false);
  assert.equal(serialized.includes("Servicio de barra"), false);
  assert.equal(serialized.includes("2023-01-01"), false);
});

test("loads authenticated status through one session snapshot without sequential user queries", async () => {
  const team = [{ id: "u2", displayName: "Compañera", loginIdentifier: "privado", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 75 }];
  const response = await handleAdminAuthRequest(
    new Request("https://equipo.example/api/auth/status", { headers: { cookie: "estrellas_session=private-cookie-token" } }),
    dependencies({ repository: {
      async getBootstrapState() { return { allowed: false, organizationId: null }; },
      async findSessionSnapshot(tokenHash, now) {
        assert.equal(tokenHash, "token-hash");
        assert.equal(now, "2026-08-22T12:00:00.000Z");
        return {
          actor: { userId: "u1", displayName: "Roberto", role: "worker", organizationId: "o1", membershipId: "m1" },
          users: team,
        };
      },
      async findSessionActor() { throw new Error("status must not perform a second session query"); },
      async listOrganizationUsers() { throw new Error("status must not perform a sequential users query"); },
    } }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.account, { userId: "u1", displayName: "Roberto", role: "worker" });
  assert.deepEqual(body.team, [{ id: "u2", displayName: "Compañera", status: "active", role: "worker", jobTitle: "waiter", tipFactorHundredths: 75, email: null, phone: null, bio: null, hiredOn: null }]);
});

test("reports a valid scoped recovery grant only after administrator setup is closed", async () => {
  const response = await handleAdminAuthRequest(new Request("https://equipo.example/api/auth/status", { headers: { cookie: "estrellas_recovery=signed-recovery-grant" } }), dependencies({
    repository: { async getBootstrapState() { return { allowed: false, organizationId: null }; } },
    verifyRecoveryGrant: async () => true,
  }));
  assert.equal((await response.json()).recoveryUnlocked, true);
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

test("rejects every unsupported sensitive-route verb before parsing a body or calling services", async () => {
  let repositoryCalls = 0;
  const repository = {
    async findLoginAccount() { repositoryCalls += 1; return null; },
    async findSessionActor() { repositoryCalls += 1; return null; },
    async openEvaluationCycle() { repositoryCalls += 1; return { created: true }; },
    async closeEvaluationCycle() { repositoryCalls += 1; return { updated: true }; },
    async deleteEvaluationShift() { repositoryCalls += 1; return { deleted: true }; },
    async setEvaluationSubmissionStatus() { repositoryCalls += 1; return { updated: true }; },
    async voidEvaluationHistory() { repositoryCalls += 1; return { updated: true, count: 0 }; },
  };

  const identifier = "11111111-1111-4111-8111-111111111111";
  const cases = [
    ["/api/auth/login", "PATCH", "POST"],
    ["/api/admin/evaluation-cycles", "DELETE", "POST"],
    [`/api/admin/evaluation-cycles/${identifier}/close`, "PATCH", "POST"],
    [`/api/admin/evaluation-shifts/${identifier}`, "PATCH", "DELETE"],
    [`/api/admin/evaluation-submissions/${identifier}/status`, "POST", "PATCH"],
    [`/api/admin/evaluation-history/${identifier}`, "POST", "DELETE"],
    [`/api/admin/users/${identifier}`, "POST", "PATCH, DELETE"],
  ];

  for (const [path, method, allow] of cases) {
    const response = await handleAdminAuthRequest(
      new Request(`https://equipo.example${path}`, {
        method,
        headers: { origin: "https://equipo.example", "content-type": "application/json" },
        body: "{",
      }),
      dependencies({ repository }),
    );

    assert.equal(response.status, 405, `${method} ${path}`);
    assert.equal(response.headers.get("allow"), allow, `${method} ${path}`);
    assert.deepEqual(await response.json(), { ok: false, error: "method_not_allowed" });
  }
  assert.equal(repositoryCalls, 0);
});

test("routes worker edit, lifecycle, and password reset only through an administrator session", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const admin = { async findSessionActor() { return { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m1" }; } };
  const headers = { cookie: "estrellas_session=private-cookie-token" };
  const edit = await handleAdminAuthRequest(mutation(`/api/admin/users/${userId}`, { displayName: "Garzón", loginIdentifier: "garzon", jobTitle: "waiter", tipPercentage: 65 }, headers, "PATCH"), dependencies({ repository: admin }));
  const status = await handleAdminAuthRequest(mutation(`/api/admin/users/${userId}/status`, { status: "suspended" }, headers), dependencies({ repository: admin }));
  const password = await handleAdminAuthRequest(mutation(`/api/admin/users/${userId}/password`, { newPassword: "Credencial privada nueva 2026" }, headers), dependencies({ repository: admin }));
  const removal = await handleAdminAuthRequest(mutation(`/api/admin/users/${userId}`, { confirmation: "garzon" }, headers, "DELETE"), dependencies({ repository: admin }));
  const unauthorized = await handleAdminAuthRequest(mutation(`/api/admin/users/${userId}/status`, { status: "suspended" }), dependencies());
  assert.deepEqual([edit.status, status.status, password.status, removal.status, unauthorized.status], [200, 200, 200, 200, 401]);
});

test("rejects malformed worker resource identifiers before repository mutation", async () => {
  const response = await handleAdminAuthRequest(mutation("/api/admin/users/not-an-id/status", { status: "suspended" }, { cookie: "estrellas_session=private-cookie-token" }), dependencies({ repository: { async findSessionActor() { return { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m1" }; } } }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "not_found" });
});

test("returns a bounded organization audit timeline only to the administrator", async () => {
  const events = [{ id: "a1", action: "user.created", objectType: "user", objectId: "u1", reason: null, metadata: {}, createdAt: "2026-08-22T14:00:00.000Z", actorDisplayName: "Jefe" }];
  const adminRepository = {
    async findSessionActor() { return { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m1" }; },
    async listAuditEvents(organizationId, limit) { assert.equal(organizationId, "o1"); assert.equal(limit, 50); return events; },
  };
  const authorized = await handleAdminAuthRequest(new Request("https://equipo.example/api/admin/audit?limit=999", { headers: { cookie: "estrellas_session=private-cookie-token" } }), dependencies({ repository: adminRepository }));
  const unauthorized = await handleAdminAuthRequest(new Request("https://equipo.example/api/admin/audit"), dependencies());
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { ok: true, events });
  assert.equal(unauthorized.status, 401);
});

test("forbids a worker from reading administrative audit events", async () => {
  const response = await handleAdminAuthRequest(new Request("https://equipo.example/api/admin/audit", { headers: { cookie: "estrellas_session=private-cookie-token" } }), dependencies({ repository: { async findSessionActor() { return { userId: "worker", displayName: "Garzón", role: "worker", organizationId: "o1", membershipId: "mw" }; } } }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "admin_required" });
});

test("lets only the administrator load and configure real evaluation operations", async () => {
  const actor = { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" };
  const operations = { period: null, shifts: [], members: [{ membershipId: "m-worker", displayName: "Garzón", jobTitle: "waiter", status: "active" }] };
  const repository = {
    async findSessionActor() { return actor; },
    async getEvaluationOperations(organizationId) { assert.equal(organizationId, "o1"); return operations; },
  };
  const response = await handleAdminAuthRequest(new Request("https://equipo.example/api/admin/evaluation-operations", { headers: { cookie: "estrellas_session=private-cookie-token" } }), dependencies({ repository }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, operations });
});

test("opens an evaluation cycle and registers a completed shared shift", async () => {
  const calls = [];
  const actor = { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" };
  const repository = {
    async findSessionActor() { return actor; },
    async openEvaluationCycle(record) { calls.push({ type: "cycle", record }); return { created: true }; },
    async createEvaluationShift(record) { calls.push({ type: "shift", record }); return { created: true }; },
    async closeEvaluationCycle(record) { calls.push({ type: "close", record }); return { updated: true }; },
  };
  const headers = { cookie: "estrellas_session=private-cookie-token" };
  const cycle = await handleAdminAuthRequest(mutation("/api/admin/evaluation-cycles", { name: "Ciclo agosto", startsAt: "2026-08-23T00:00:00.000Z", endsAt: "2026-09-23T23:59:59.000Z" }, headers), dependencies({ repository }));
  const shift = await handleAdminAuthRequest(mutation("/api/admin/evaluation-shifts", { section: "Salón principal", startsAt: "2026-08-22T18:00:00.000Z", endsAt: "2026-08-23T02:00:00.000Z", membershipIds: ["m-worker-1", "m-worker-2"] }, headers), dependencies({ repository }));
  const close = await handleAdminAuthRequest(mutation("/api/admin/evaluation-cycles/period-1/close", { reason: "Cierre mensual revisado" }, headers), dependencies({ repository }));

  assert.deepEqual([cycle.status, shift.status, close.status], [201, 201, 200]);
  assert.equal(calls[0].record.organizationId, "o1");
  assert.equal(calls[0].record.createdByMembershipId, "m-admin");
  assert.equal(calls[0].record.criteria.length, 6);
  assert.deepEqual(calls[0].record.criteria.map(({ code, name, weightBasisPoints }) => ({ code, name, weightBasisPoints })), [
    { code: "discipline", name: "Disciplina, puntualidad y presentación", weightBasisPoints: 1667 },
    { code: "operational_responsibility", name: "Responsabilidad y precisión operativa", weightBasisPoints: 1667 },
    { code: "customer_experience", name: "Atención y experiencia del cliente", weightBasisPoints: 1667 },
    { code: "menu_knowledge", name: "Conocimiento de carta y recomendación", weightBasisPoints: 1667 },
    { code: "teamwork", name: "Comunicación, compañerismo y trabajo en equipo", weightBasisPoints: 1666 },
    { code: "continuous_improvement", name: "Autocrítica, aprendizaje y mejora continua", weightBasisPoints: 1666 },
  ]);
  assert.deepEqual(calls[0].record.criteria.map(({ description }) => description), [
    "Llega a tiempo, cumple horarios, mantiene uniforme y presentación adecuados, respeta normas y permanece preparado durante el turno.",
    "Toma comandas correctamente, confirma pedidos, evita errores, cumple sus tareas de apertura y cierre, y se hace responsable de lo que le corresponde.",
    "Recibe con amabilidad, escucha, explica con claridad, anticipa necesidades, maneja reclamos correctamente y mantiene un servicio profesional.",
    "Conoce comidas, ingredientes, alérgenos, tragos y vinos; puede explicarlos con fluidez y recomendar opciones apropiadas sin inventar información.",
    "Informa oportunamente, coordina con salón, barra y caja, ayuda cuando un compañero está sobrecargado y evita conflictos o comentarios perjudiciales.",
    "Reconoce errores, acepta correcciones, evita repetirlos, pregunta cuando desconoce algo y demuestra avances reales durante el período evaluado.",
  ]);
  assert.equal(calls[0].record.criteria.reduce((total, criterion) => total + criterion.weightBasisPoints, 0), 10_000);
  assert.deepEqual(calls[1].record.membershipIds, ["m-worker-1", "m-worker-2"]);
  assert.equal(calls[2].type, "close");
  assert.deepEqual({ ...calls[2].record, auditId: "bounded-generated-id" }, { periodId: "period-1", organizationId: "o1", actorMembershipId: "m-admin", auditId: "bounded-generated-id", reason: "Cierre mensual revisado", now: "2026-08-22T12:00:00.000Z" });
});

test("rejects a multi-day record because evaluations require a real daily shift", async () => {
  let shiftWrites = 0;
  const repository = {
    async findSessionActor() { return { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" }; },
    async createEvaluationShift() { shiftWrites += 1; return { created: true }; },
  };
  const response = await handleAdminAuthRequest(mutation("/api/admin/evaluation-shifts", {
    section: "Turno general",
    startsAt: "2026-08-24T18:00:00.000Z",
    endsAt: "2026-09-24T02:00:00.000Z",
    membershipIds: ["m-worker-1", "m-worker-2"],
  }, { cookie: "estrellas_session=private-cookie-token" }), dependencies({ repository }));

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_shift_duration" });
  assert.equal(shiftWrites, 0);
});

test("deletes only an empty shift through an administrator session", async () => {
  const shiftId = "0be8173f-c068-478e-84cc-dc7f2ac3161e";
  const calls = [];
  const repository = {
    async findSessionActor() { return { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" }; },
    async deleteEvaluationShift(record) { calls.push(record); return { deleted: true }; },
  };
  const response = await handleAdminAuthRequest(mutation(
    `/api/admin/evaluation-shifts/${shiftId}`,
    { reason: "Turno registrado con fechas incorrectas" },
    { cookie: "estrellas_session=private-cookie-token" },
    "DELETE",
  ), dependencies({ repository }));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0], auditId: "bounded-generated-id" }, {
    shiftId,
    organizationId: "o1",
    actorMembershipId: "m-admin",
    auditId: "bounded-generated-id",
    reason: "Turno registrado con fechas incorrectas",
    now: "2026-08-22T12:00:00.000Z",
  });
});

test("permanently deletes only a confirmed legacy cycle through an administrator session", async () => {
  const periodId = "4a9627e4-0d7e-4cf0-abac-61a617cb5126";
  const calls = [];
  const actor = { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" };
  const repository = {
    async findSessionActor() { return actor; },
    async deleteEvaluationCycle(record) { calls.push(record); return { deleted: true }; },
  };
  const headers = { cookie: "estrellas_session=private-cookie-token" };
  const valid = await handleAdminAuthRequest(mutation(`/api/admin/evaluation-cycles/${periodId}`, {
    confirmation: "CONFIRMO ELIMINAR CICLO ANTIGUO",
    reason: "Reemplazo autorizado por el ciclo mensual oficial",
  }, headers, "DELETE"), dependencies({ repository }));
  const invalid = await handleAdminAuthRequest(mutation(`/api/admin/evaluation-cycles/${periodId}`, {
    confirmation: "eliminar",
    reason: "Reemplazo autorizado por el ciclo mensual oficial",
  }, headers, "DELETE"), dependencies({ repository }));

  assert.deepEqual([valid.status, invalid.status], [200, 422]);
  assert.deepEqual(await invalid.json(), { ok: false, error: "invalid_cycle_delete" });
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0], auditId: "bounded-generated-id" }, {
    periodId,
    organizationId: "o1",
    actorMembershipId: "m-admin",
    auditId: "bounded-generated-id",
    reason: "Reemplazo autorizado por el ciclo mensual oficial",
    now: "2026-08-22T12:00:00.000Z",
  });
});

test("lets only an administrator moderate one evaluation and bulk-void a person's history", async () => {
  const adminActor = { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "11111111-1111-4111-8111-111111111111" };
  const workerActor = { ...adminActor, role: "worker", membershipId: "22222222-2222-4222-8222-222222222222" };
  const calls = [];
  const repository = {
    async findSessionActor() { return adminActor; },
    async setEvaluationSubmissionStatus(record) { calls.push({ type: "single", record }); return { updated: true }; },
    async voidEvaluationHistory(record) { calls.push({ type: "bulk", record }); return { updated: true, count: 3 }; },
  };
  const headers = { cookie: "estrellas_session=private-cookie-token" };
  const submissionId = "33333333-3333-4333-8333-333333333333";
  const membershipId = "44444444-4444-4444-8444-444444444444";

  const single = await handleAdminAuthRequest(mutation(`/api/admin/evaluation-submissions/${submissionId}/status`, { action: "void", reason: "Evaluación anterior al acuerdo vigente" }, headers, "PATCH"), dependencies({ repository }));
  const bulk = await handleAdminAuthRequest(mutation(`/api/admin/evaluation-history/${membershipId}`, { scope: "all", confirmation: "ANULAR HISTORIAL", reason: "Corrección completa autorizada por administración" }, headers, "DELETE"), dependencies({ repository }));
  const forbidden = await handleAdminAuthRequest(mutation(`/api/admin/evaluation-submissions/${submissionId}/status`, { action: "void", reason: "Intento no autorizado" }, headers, "PATCH"), dependencies({ repository: { ...repository, async findSessionActor() { return workerActor; } } }));
  const invalidBulk = await handleAdminAuthRequest(mutation(`/api/admin/evaluation-history/${membershipId}`, { scope: "all", confirmation: "borrar", reason: "Confirmación incorrecta" }, headers, "DELETE"), dependencies({ repository }));

  assert.equal(single.status, 200);
  assert.deepEqual(await single.json(), { ok: true });
  assert.equal(bulk.status, 200);
  assert.deepEqual(await bulk.json(), { ok: true, count: 3 });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { ok: false, error: "admin_required" });
  assert.equal(invalidBulk.status, 422);
  assert.deepEqual(await invalidBulk.json(), { ok: false, error: "invalid_history_delete" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].record.status, "voided");
  assert.equal(calls[1].record.scope, "all");
});

test("updates a worker profile and avatar only through an authenticated account", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const calls = [];
  const actor = { userId: "22222222-2222-4222-8222-222222222222", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" };
  const repository = {
    async findSessionActor() { return actor; },
    async updateUserProfile(record) { calls.push({ type: "profile", record }); return { updated: true }; },
    async updateUserAvatar(record) { calls.push({ type: "avatar", record }); return { updated: true }; },
  };
  const headers = { cookie: "estrellas_session=private-cookie-token" };
  const profile = await handleAdminAuthRequest(mutation(`/api/admin/users/${userId}/profile`, { email: "garzon@example.com", phone: "+56912345678", bio: "Servicio", hiredOn: "2026-08-25" }, headers, "PATCH"), dependencies({ repository }));
  const avatar = await handleAdminAuthRequest(mutation(`/api/admin/users/${userId}/avatar`, { mimeType: "image/webp", base64: "UklGRgAAAABXRUJQ" }, headers), dependencies({ repository }));
  assert.deepEqual([profile.status, avatar.status], [200, 200]);
  assert.deepEqual(calls.map(({ type }) => type), ["profile", "avatar"]);
});

test("serves a private authenticated avatar with its real media type", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const response = await handleAdminAuthRequest(new Request(`https://equipo.example/api/users/${userId}/avatar`, { headers: { cookie: "estrellas_session=private-cookie-token" } }), dependencies({ repository: {
    async findSessionActor() { return { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" }; },
    async findUserAvatar() { return { mimeType: "image/webp", base64: "UklGRgAAAABXRUJQ", updatedAt: "2026-08-25T00:00:00.000Z" }; },
  } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "private, max-age=3600");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("requires session, unique key, current password and exact phrase for a total reset", async () => {
  let resets = 0;
  const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" };
  const repository = {
    async findSessionActor() { return actor; },
    async findAdministratorCredential() { return { passwordHash: "password-hash" }; },
    async resetSystem() { resets += 1; return { reset: true }; },
  };
  const response = await handleAdminAuthRequest(mutation("/api/admin/system/reset", { accessKey: "clave-unica", password: "contraseña-real", confirmation: "ELIMINAR TODO Y REINICIAR" }, { cookie: "estrellas_session=private-cookie-token" }), dependencies({ repository, verifySetupAccessKey: async () => true }));
  assert.equal(response.status, 200);
  assert.equal(resets, 1);
  assert.match(response.headers.get("set-cookie"), /^estrellas_session=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/);
});

test("requires administrator session and the unique setup key for an operational history purge", async () => {
  const headers = { cookie: "estrellas_session=private-cookie-token" };
  const actor = { async findSessionActor() { return { userId: "admin", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m1" }; } };
  const accepted = await handleAdminAuthRequest(mutation("/api/admin/system/purge-history", { accessKey: "unique-key", password: "password", confirmation: "BORRAR HISTORIAL OPERATIVO" }, headers), dependencies({ repository: actor, verifySetupAccessKey: async () => true }));
  const rejectedKey = await handleAdminAuthRequest(mutation("/api/admin/system/purge-history", { accessKey: "wrong", password: "password", confirmation: "BORRAR HISTORIAL OPERATIVO" }, headers), dependencies({ repository: actor, verifySetupAccessKey: async () => false }));
  assert.deepEqual([accepted.status, rejectedKey.status], [200, 401]);
});

test("distinguishes a rejected reset key from a rejected current password for the signed-in administrator", async () => {
  const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Jefe", role: "admin", organizationId: "o1", membershipId: "m-admin" };
  const repository = {
    async findSessionActor() { return actor; },
    async findAdministratorCredential() { return { passwordHash: "password-hash" }; },
  };
  const request = mutation("/api/admin/system/reset", { accessKey: "clave-equivocada", password: "contraseña-equivocada", confirmation: "ELIMINAR TODO Y REINICIAR" }, { cookie: "estrellas_session=private-cookie-token" });
  const response = await handleAdminAuthRequest(request, dependencies({ repository, verifySetupAccessKey: async () => false }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_reset_access_key" });
});
