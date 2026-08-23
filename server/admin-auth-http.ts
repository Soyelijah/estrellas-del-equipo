import { bootstrapAdministrator, createManagedUser, loginWithPassword, recoverAdministratorPassword, resetManagedUserPassword, setManagedUserStatus, updateManagedUser } from "./admin-auth-service.ts";
import { isSameOriginMutation } from "./request-security.ts";

const COOKIE_NAME = "estrellas_session";
const SETUP_COOKIE_NAME = "estrellas_setup";
const RECOVERY_COOKIE_NAME = "estrellas_recovery";
const MAX_JSON_BYTES = 8_192;

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
    findSessionActor(tokenHash: string, now: string): Promise<{ userId: string; displayName: string; role: "admin" | "team_lead" | "worker" | "independent_reviewer"; organizationId: string; membershipId: string } | null>;
    revokeSession(tokenHash: string, now: string): Promise<void>;
    listOrganizationUsers(organizationId: string): Promise<unknown[]>;
    listAuditEvents(organizationId: string, limit: number): Promise<unknown[]>;
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

async function readBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return { ok: false, response: json({ ok: false, error: "payload_too_large" }, 413) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) return { ok: false, response: json({ ok: false, error: "payload_too_large" }, 413) };
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
      const [bootstrap, actor] = await Promise.all([
        dependencies.repository.getBootstrapState(),
        actorFor(request, dependencies),
      ]);
      const setupUnlocked = bootstrap.allowed && await dependencies.verifySetupGrant(cookieValue(request, SETUP_COOKIE_NAME));
      const recoveryUnlocked = !bootstrap.allowed && await dependencies.verifyRecoveryGrant(cookieValue(request, RECOVERY_COOKIE_NAME));
      const organizationUsers = actor ? await dependencies.repository.listOrganizationUsers(actor.organizationId) as Array<Record<string, unknown>> : [];
      const users = actor?.role === "admin" ? organizationUsers : [];
      const team = organizationUsers.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        status: member.status,
        role: member.role,
        jobTitle: member.jobTitle,
        tipFactorHundredths: member.tipFactorHundredths,
      }));
      return json({
        ok: true,
        bootstrapAllowed: bootstrap.allowed,
        setupUnlocked,
        recoveryUnlocked,
        account: actor ? { displayName: actor.displayName, role: actor.role } : null,
        users,
        team,
      });
    }

    if (path === "/api/admin/audit" && request.method === "GET") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      if (actor.role !== "admin") return json({ ok: false, error: "admin_required" }, 403);
      const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
      const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 50;
      return json({ ok: true, events: await dependencies.repository.listAuditEvents(actor.organizationId, limit) });
    }

    if (request.method !== "POST" && request.method !== "PATCH") return json({ ok: false, error: "method_not_allowed" }, 405, { allow: "GET, POST, PATCH" });
    if (!isSameOriginMutation(request)) return json({ ok: false, error: "cross_origin_request" }, 403);
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const serviceDependencies = { ...dependencies, now: dependencies.now() };

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
    if (path === "/api/admin/users") {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const result = await createManagedUser(parsed.body as never, actor, serviceDependencies);
      return result.ok
        ? json({ ok: true, userId: result.userId, displayName: result.displayName }, result.status)
        : json({ ok: false, error: result.error }, result.status);
    }
    const userRoute = path.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(status|password))?$/iu);
    if (userRoute) {
      const actor = await actorFor(request, dependencies);
      if (!actor) return json({ ok: false, error: "authentication_required" }, 401);
      const [, userId, action] = userRoute;
      const result = action === "status" && request.method === "POST"
        ? await setManagedUserStatus({ ...parsed.body, userId } as never, actor, serviceDependencies)
        : action === "password" && request.method === "POST"
          ? await resetManagedUserPassword({ ...parsed.body, userId } as never, actor, serviceDependencies)
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
