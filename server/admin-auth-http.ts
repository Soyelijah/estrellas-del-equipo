import { bootstrapAdministrator, createManagedUser, loginWithPassword, recoverAdministratorPassword, resetManagedUserPassword, resetSystem, setManagedUserStatus, updateManagedUser, updateUserAvatar, updateUserProfile } from "./admin-auth-service.ts";
import { closeEvaluationCycle, deleteEvaluationCyclePermanently, deleteEvaluationShift, moderateEvaluationSubmission, openEvaluationCycle, registerEvaluationShift, voidMemberEvaluationHistory } from "./evaluation-admin-service.ts";
import { isSameOriginMutation } from "./request-security.ts";

const COOKIE_NAME = "estrellas_session";
const SETUP_COOKIE_NAME = "estrellas_setup";
const RECOVERY_COOKIE_NAME = "estrellas_recovery";
const MAX_JSON_BYTES = 8_192;
const MAX_AVATAR_JSON_BYTES = 225_000;

type AuthDependencies = {
  repository: {
    getBootstrapState(): Promise<{ allowed: boolean; organizationId: string | null }>;
    saveBootstrap(record: Record<string, unknown>): Promise<{ created: boolean }>;
    findLoginAccount(loginIdentifier: string): Promise<Record<string, string> | null>;
    saveSession(record: Record<string, string>): Promise<void>;
    createManagedUser(record: Record<string, unknown>): Promise<{ created: boolean }>;
    recoverAdministratorPassword(record: Record<string, string>): Promise<{ updated: boolean }>;
    updateManagedUser(record: Record<string, unknown>): Promise<{ updated: boolean; conflict: boolean }>;
    setManagedUserStatus(record: Record<string, string>): Promise<{ updated: boolean }>;
    resetManagedUserPassword(record: Record<string, string>): Promise<{ updated: boolean }>;
    updateUserProfile(record: Record<string, unknown>): Promise<{ updated: boolean }>;
    updateUserAvatar(record: Record<string, unknown>): Promise<{ updated: boolean }>;
    findUserAvatar(userId: string, organizationId: string): Promise<{ mimeType: string; base64: string; updatedAt: string } | null>;
    findAdministratorCredential(userId: string, organizationId: string): Promise<{ passwordHash: string } | null>;
    resetSystem(record: Record<string, string>): Promise<{ reset: boolean }>;
    findSessionActor(tokenHash: string, now: string): Promise<{ userId: string; displayName: string; role: "admin" | "team_lead" | "worker" | "independent_reviewer"; organizationId: string; membershipId: string } | null>;
    findSessionSnapshot(tokenHash: string, now: string): Promise<{
      actor: { userId: string; displayName: string; role: "admin" | "team_lead" | "worker" | "independent_reviewer"; organizationId: string; membershipId: string };
      users: Array<Record<string, unknown>>;
    } | null>;
    revokeSession(tokenHash: string, now: string): Promise<void>;
    listOrganizationUsers(organizationId: string): Promise<unknown[]>;
    listAuditEvents(organizationId: string, limit: number): Promise<unknown[]>;
    getEvaluationOperations(organizationId: string): Promise<unknown>;
    openEvaluationCycle(record: Record<string, unknown>): Promise<{ created: true } | { created: false; reason: string }>;
    createEvaluationShift(record: Record<string, unknown>): Promise<{ created: true } | { created: false; reason: string }>;
    deleteEvaluationShift(record: Record<string, unknown>): Promise<{ deleted: true } | { deleted: false; reason: string }>;
    setEvaluationSubmissionStatus(record: Record<string, unknown>): Promise<{ updated: true } | { updated: false; reason: string }>;
    voidEvaluationHistory(record: Record<string, unknown>): Promise<{ updated: true; count: number } | { updated: false; reason: string }>;
    closeEvaluationCycle(record: Record<string, unknown>): Promise<{ updated: boolean }>;
    deleteEvaluationCycle(record: Record<string, unknown>): Promise<{ deleted: boolean }>;
  };
  createId(): string;
  createToken(): string;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
  hashToken(token: string): Promise<string>;
  setupAccessConfigured: boolean;
  verifySetupAccessKey(accessKey: unknown): Promise<boolean>;
  createSetupGrant(): Promise<string>;
  verifySetupGrant(grant: unknown): Promise<boolean>;
  createRecoveryGrant(): Promise<string>;
  verifyRecoveryGrant(grant: unknown): Promise<boolean>;
  now(): string;
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function cookieValue(request: Request, cookieName = COOKIE_NAME): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookieName) return value.join("=") || null;
  }
  return null;
}

export function readSessionToken(request: Request): string | null {
  return cookieValue(request);
}

function setupCookie(request: Request, token: string, clear = false): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SETUP_COOKIE_NAME}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 600}${secure}`;
}

function sessionCookie(request: Request, token: string, clear = false): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28_800}${secure}`;
}

function recoveryCookie(request: Request, token: string, clear = false): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${RECOVERY_COOKIE_NAME}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 600}${secure}`;
}

async function readBody(request: Request, maxBytes = MAX_JSON_BYTES): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: json({ ok: false, error: "payload_too_large" }, 413) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { ok: false, response: json({ ok: false, error: "payload_too_large" }, 413) };
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: json({ ok: false, error: "invalid_json" }, 400) };
  }
}

async function actorFor(request: Request, dependencies: AuthDependencies) {
  const token = cookieValue(request);
  if (!token) return null;
  return dependencies.repository.findSessionActor(await dependencies.hashToken(token), dependencies.now());
}

export async function handleAdminAuthRequest(request: Request, dependencies: AuthDependencies): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (path === "/api/auth/status" && request.method === "GET") {
      const token = cookieValue(request);
      const tokenHash = token ? await dependencies.hashToken(token) : null;
      const [bootstrap, session] = await Promise.all([
        dependencies.repository.getBootstrapState(),
        tokenHash
          ? dependencies.repository.findSessionSnapshot(tokenHash, dependencies.now())
          : Promise.resolve(null),
      ]);
      const actor = session?.actor ?? null;
      const setupUnlocked = bootstrap.allowed && await dependencies.verifySetupGrant(cookieValue(request, SETUP_COOKIE_NAME));
      const recoveryUnlocked = !bootstrap.allowed && await dependencies.verifyRecoveryGrant(cookieValue(request, RECOVERY_COOKIE_NAME));
      const organizationUsers = session?.users ?? [];
      const users = actor?.role === "admin" ? organizationUsers : [];
      const team = organizationUsers.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        status: member.status,
        role: member.role,
        jobTitle: member.jobTitle,
        tipFactorHundredths: member.tipFactorHundredths,
        email: member.email,
        phone: member.phone,
        bio: member.bio,
        hiredOn: member.hiredOn,
        hasAvatar: member.hasAvatar,
      }));
      return json({
        ok: true,
        bootstrapAllowed: bootstrap.allowed,
        setupUnlocked,
        recoveryUnlocked,
        account: actor ? { userId: actor.userId, displayName: actor.displayName, role: actor.role } : null,
        users,
        team,
      });
    }

    const avatarReadMatch = path.match(/^\/api\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/avatar$/iu);
    if (avatarReadMatch && request.method === "GET") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const avatar = await dependencies.repository.findUserAvatar(avatarReadMatch[1], actor.organizationId);
      if (!avatar) return json({ ok: false, error: "avatar_not_found" }, 404);
      const binary = Uint8Array.from(atob(avatar.base64), (character) => character.charCodeAt(0));
      return new Response(binary, { status: 200, headers: { "content-type": avatar.mimeType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", etag: `\"${avatar.updatedAt}\"` } });
    }

    if (path === "/api/admin/audit" && request.method === "GET") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      if (actor.role !== "admin") return json({ ok: false, error: "admin_required" }, 403);
      const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
      const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 50;
      return json({ ok: true, events: await dependencies.repository.listAuditEvents(actor.organizationId, limit) });
    }

    if (path === "/api/admin/evaluation-operations" && request.method === "GET") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      if (actor.role !== "admin") return json({ ok: false, error: "admin_required" }, 403);
      return json({ ok: true, operations: await dependencies.repository.getEvaluationOperations(actor.organizationId) });
    }

    if (request.method !== "POST" && request.method !== "PATCH" && request.method !== "DELETE") return json({ ok: false, error: "method_not_allowed" }, 405, { allow: "GET, POST, PATCH, DELETE" });
    if (!isSameOriginMutation(request)) return json({ ok: false, error: "cross_origin_request" }, 403);
    const parsed = await readBody(request, path.endsWith("/avatar") ? MAX_AVATAR_JSON_BYTES : MAX_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const serviceDependencies = { ...dependencies, now: dependencies.now() };

    if (path === "/api/admin/evaluation-cycles") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await openEvaluationCycle(parsed.body, actor, {
        repository: dependencies.repository,
        createId: dependencies.createId,
        now: serviceDependencies.now,
      });
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }

    if (path === "/api/admin/evaluation-shifts") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await registerEvaluationShift(parsed.body, actor, {
        repository: dependencies.repository,
        createId: dependencies.createId,
        now: serviceDependencies.now,
      });
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }

    const deleteShiftMatch = path.match(/^\/api\/admin\/evaluation-shifts\/([^/]+)$/);
    if (request.method === "DELETE" && deleteShiftMatch) {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await deleteEvaluationShift(parsed.body, actor, {
        repository: dependencies.repository,
        createId: dependencies.createId,
        now: serviceDependencies.now,
        shiftId: deleteShiftMatch[1],
      });
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }

    const submissionStatusMatch = path.match(/^\/api\/admin\/evaluation-submissions\/([^/]+)\/status$/);
    if (request.method === "PATCH" && submissionStatusMatch) {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await moderateEvaluationSubmission(parsed.body, actor, {
        repository: dependencies.repository,
        createId: dependencies.createId,
        now: serviceDependencies.now,
        submissionId: submissionStatusMatch[1],
      });
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }

    const memberHistoryMatch = path.match(/^\/api\/admin\/evaluation-history\/([^/]+)$/);
    if (request.method === "DELETE" && memberHistoryMatch) {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await voidMemberEvaluationHistory(parsed.body, actor, {
        repository: dependencies.repository,
        createId: dependencies.createId,
        now: serviceDependencies.now,
        membershipId: memberHistoryMatch[1],
      });
      return result.ok ? json({ ok: true, count: result.count }, result.status) : json({ ok: false, error: result.error }, result.status);
    }

    const closeCycleMatch = path.match(/^\/api\/admin\/evaluation-cycles\/([^/]+)\/close$/);
    if (closeCycleMatch) {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await closeEvaluationCycle(parsed.body, actor, {
        repository: dependencies.repository,
        createId: dependencies.createId,
        now: serviceDependencies.now,
        periodId: closeCycleMatch[1],
      });
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }

    const deleteCycleMatch = path.match(/^\/api\/admin\/evaluation-cycles\/([^/]+)$/);
    if (request.method === "DELETE" && deleteCycleMatch) {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await deleteEvaluationCyclePermanently(parsed.body, actor, {
        repository: dependencies.repository,
        createId: dependencies.createId,
        now: serviceDependencies.now,
        periodId: deleteCycleMatch[1],
      });
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }

    if (path === "/api/auth/bootstrap/unlock") {
      const bootstrap = await dependencies.repository.getBootstrapState();
      if (!bootstrap.allowed) return json({ ok: false, error: "bootstrap_closed" }, 409);
      if (!dependencies.setupAccessConfigured) return json({ ok: false, error: "setup_access_unavailable" }, 503);
      if (!await dependencies.verifySetupAccessKey(parsed.body.accessKey)) {
        return json({ ok: false, error: "invalid_access_key" }, 401);
      }
      const grant = await dependencies.createSetupGrant();
      return json({ ok: true, setupUnlocked: true }, 200, { "set-cookie": setupCookie(request, grant) });
    }

    if (path === "/api/auth/bootstrap") {
      if (!dependencies.setupAccessConfigured || !await dependencies.verifySetupGrant(cookieValue(request, SETUP_COOKIE_NAME))) {
        return json({ ok: false, error: "setup_access_required" }, 403);
      }
      const result = await bootstrapAdministrator(parsed.body as never, serviceDependencies);
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true, displayName: result.displayName, role: result.role }, result.status, { "set-cookie": setupCookie(request, "", true) });
    }
    if (path === "/api/auth/recovery/unlock") {
      const bootstrap = await dependencies.repository.getBootstrapState();
      if (bootstrap.allowed) return json({ ok: false, error: "recovery_unavailable" }, 409);
      if (!dependencies.setupAccessConfigured) return json({ ok: false, error: "recovery_unavailable" }, 503);
      if (!await dependencies.verifySetupAccessKey(parsed.body.accessKey)) return json({ ok: false, error: "invalid_access_key" }, 401);
      return json({ ok: true, recoveryUnlocked: true }, 200, { "set-cookie": recoveryCookie(request, await dependencies.createRecoveryGrant()) });
    }
    if (path === "/api/auth/recovery/complete") {
      if (!await dependencies.verifyRecoveryGrant(cookieValue(request, RECOVERY_COOKIE_NAME))) {
        return json({ ok: false, error: "recovery_access_required" }, 403);
      }
      const result = await recoverAdministratorPassword(parsed.body as never, serviceDependencies);
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true }, result.status, { "set-cookie": recoveryCookie(request, "", true) });
    }
    if (path === "/api/auth/login") {
      const result = await loginWithPassword(parsed.body as never, serviceDependencies);
      if (!result.ok) return json({ ok: false, error: result.error }, result.status);
      return json({ ok: true, displayName: result.displayName, role: result.role }, result.status, { "set-cookie": sessionCookie(request, result.sessionToken) });
    }
    if (path === "/api/auth/logout") {
      const token = cookieValue(request);
      if (token) await dependencies.repository.revokeSession(await dependencies.hashToken(token), dependencies.now());
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, "", true) });
    }
    if (path === "/api/admin/system/reset") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      if (!dependencies.setupAccessConfigured || !await dependencies.verifySetupAccessKey(parsed.body.accessKey)) {
        return json({ ok: false, error: "invalid_reset_authorization" }, 401);
      }
      const result = await resetSystem(parsed.body as never, actor, serviceDependencies);
      return result.ok
        ? json({ ok: true }, result.status, { "set-cookie": sessionCookie(request, "", true) })
        : json({ ok: false, error: result.error }, result.status);
    }
    if (path === "/api/account/profile" || path === "/api/account/avatar") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = path.endsWith("/avatar")
        ? await updateUserAvatar({ ...parsed.body, userId: actor.userId, remove: request.method === "DELETE" } as never, actor, serviceDependencies)
        : request.method === "PATCH"
          ? await updateUserProfile({ ...parsed.body, userId: actor.userId } as never, actor, serviceDependencies)
          : null;
      if (!result) return json({ ok: false, error: "method_not_allowed" }, 405);
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }
    if (path === "/api/admin/users") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await createManagedUser(parsed.body as never, actor, serviceDependencies);
      return result.ok
        ? json({ ok: true, userId: result.userId, displayName: result.displayName }, result.status)
        : json({ ok: false, error: result.error }, result.status);
    }
    const userRoute = path.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(status|password|profile|avatar))?$/iu);
    if (userRoute) {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const [, userId, action] = userRoute;
      const result = action === "status" && request.method === "POST"
        ? await setManagedUserStatus({ ...parsed.body, userId } as never, actor, serviceDependencies)
        : action === "password" && request.method === "POST"
          ? await resetManagedUserPassword({ ...parsed.body, userId } as never, actor, serviceDependencies)
          : action === "profile" && request.method === "PATCH"
            ? await updateUserProfile({ ...parsed.body, userId } as never, actor, serviceDependencies)
            : action === "avatar" && (request.method === "POST" || request.method === "DELETE")
              ? await updateUserAvatar({ ...parsed.body, userId, remove: request.method === "DELETE" } as never, actor, serviceDependencies)
          : !action && request.method === "PATCH"
            ? await updateManagedUser({ ...parsed.body, userId } as never, actor, serviceDependencies)
            : null;
      if (!result) return json({ ok: false, error: "method_not_allowed" }, 405);
      return result.ok ? json({ ok: true }, result.status) : json({ ok: false, error: result.error }, result.status);
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch {
    return json({ ok: false, error: "internal_error" }, 500);
  }
}
