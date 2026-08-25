type Role = "admin" | "team_lead" | "worker" | "independent_reviewer";
type JobTitle = "head_waiter" | "waiter" | "bartender" | "cashier";

type AccountInput = {
  displayName: string;
  loginIdentifier: string;
  password: string;
};

type BootstrapInput = AccountInput & { organizationName: string };
type ManagedUserInput = AccountInput & { jobTitle: JobTitle; tipPercentage: string | number };

export type SessionActor = { userId?: string; role: Role; organizationId: string; membershipId: string };

type Dependencies = {
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
    findAdministratorCredential(userId: string, organizationId: string): Promise<{ passwordHash: string } | null>;
    resetSystem(record: Record<string, string>): Promise<{ reset: boolean }>;
  };
  createId(): string;
  createToken(): string;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
  hashToken(token: string): Promise<string>;
  now: string;
};

const LOGIN_PATTERN = /^[\p{L}\p{N}._@+-]{3,80}$/u;
const JOB_TITLES = new Set<JobTitle>(["head_waiter", "waiter", "bartender", "cashier"]);
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE_PATTERN = /^[\d+().\s-]{6,32}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function normalized(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function normalizeLogin(value: unknown): string {
  return normalized(value).toLocaleLowerCase("es-CL");
}

function validIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validAvatarBytes(mimeType: string, base64: string): boolean {
  try {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
    if (mimeType === "image/webp") return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    return false;
  } catch {
    return false;
  }
}

function validAccount(input: AccountInput): boolean {
  const displayName = normalized(input.displayName);
  const login = normalizeLogin(input.loginIdentifier);
  return displayName.length >= 2 && displayName.length <= 100
    && LOGIN_PATTERN.test(login)
    && typeof input.password === "string"
    && input.password.length >= 12
    && input.password.length <= 128;
}

function expiresEightHoursAfter(now: string): string {
  return new Date(new Date(now).getTime() + 8 * 60 * 60 * 1_000).toISOString();
}

async function sessionRecord(userId: string, dependencies: Dependencies) {
  const token = dependencies.createToken();
  return {
    token,
    record: {
      id: dependencies.createId(),
      userId,
      tokenHash: await dependencies.hashToken(token),
      createdAt: dependencies.now,
      expiresAt: expiresEightHoursAfter(dependencies.now),
    },
  };
}

export async function bootstrapAdministrator(input: BootstrapInput, dependencies: Dependencies) {
  if (!validAccount(input) || normalized(input.organizationName).length < 2 || normalized(input.organizationName).length > 120) {
    return { ok: false as const, status: 422, error: "invalid_account_data" };
  }
  const state = await dependencies.repository.getBootstrapState();
  if (!state.allowed) return { ok: false as const, status: 409, error: "bootstrap_closed" };

  const organizationId = state.organizationId ?? dependencies.createId();
  const userId = dependencies.createId();
  const membershipId = dependencies.createId();
  const loginIdentifier = normalizeLogin(input.loginIdentifier);
  const passwordHash = await dependencies.hashPassword(input.password);
  const created = await dependencies.repository.saveBootstrap({
    organization: state.organizationId ? null : { id: organizationId, name: normalized(input.organizationName), createdAt: dependencies.now },
    user: {
      id: userId,
      authSubject: `local:${userId}`,
      displayName: normalized(input.displayName),
      loginIdentifier,
      passwordHash,
      status: "active",
      createdAt: dependencies.now,
    },
    membership: { id: membershipId, organizationId, userId, role: "admin", status: "active", joinedAt: dependencies.now },
    guard: { key: "administrator_bootstrap", createdAt: dependencies.now },
  });
  if (!created.created) return { ok: false as const, status: 409, error: "bootstrap_closed" };
  return { ok: true as const, status: 201, displayName: normalized(input.displayName), role: "admin" as const };
}

export async function loginWithPassword(input: Pick<AccountInput, "loginIdentifier" | "password">, dependencies: Dependencies) {
  const loginIdentifier = normalizeLogin(input.loginIdentifier);
  if (!LOGIN_PATTERN.test(loginIdentifier) || typeof input.password !== "string" || input.password.length > 128) {
    return { ok: false as const, status: 401, error: "invalid_credentials" };
  }
  const account = await dependencies.repository.findLoginAccount(loginIdentifier);
  if (!account || account.status !== "active" || !await dependencies.verifyPassword(input.password, account.passwordHash)) {
    return { ok: false as const, status: 401, error: "invalid_credentials" };
  }
  const session = await sessionRecord(account.userId, dependencies);
  await dependencies.repository.saveSession(session.record);
  return { ok: true as const, status: 200, sessionToken: session.token, displayName: account.displayName, role: account.role as Role };
}

export async function recoverAdministratorPassword(input: { loginIdentifier: string; newPassword: string }, dependencies: Dependencies) {
  const loginIdentifier = normalizeLogin(input.loginIdentifier);
  if (!LOGIN_PATTERN.test(loginIdentifier) || typeof input.newPassword !== "string" || input.newPassword.length < 12 || input.newPassword.length > 128) {
    return { ok: false as const, status: 422, error: "invalid_recovery_data" };
  }
  const result = await dependencies.repository.recoverAdministratorPassword({
    loginIdentifier,
    passwordHash: await dependencies.hashPassword(input.newPassword),
    auditId: dependencies.createId(),
    now: dependencies.now,
  });
  if (!result.updated) return { ok: false as const, status: 401, error: "invalid_recovery" };
  return { ok: true as const, status: 200 };
}

export async function createManagedUser(input: ManagedUserInput, actor: SessionActor, dependencies: Dependencies) {
  if (actor.role !== "admin") return { ok: false as const, status: 403, error: "admin_required" };
  const tipFactorHundredths = typeof input.tipPercentage === "number" ? input.tipPercentage : Number(input.tipPercentage);
  if (!validAccount(input) || !JOB_TITLES.has(input.jobTitle) || !Number.isInteger(tipFactorHundredths) || tipFactorHundredths < 1 || tipFactorHundredths > 100 || (input.jobTitle === "cashier" && tipFactorHundredths !== 50)) {
    return { ok: false as const, status: 422, error: "invalid_account_data" };
  }
  const userId = dependencies.createId();
  const membershipId = dependencies.createId();
  const created = await dependencies.repository.createManagedUser({
    user: {
      id: userId,
      authSubject: `local:${userId}`,
      displayName: normalized(input.displayName),
      loginIdentifier: normalizeLogin(input.loginIdentifier),
      passwordHash: await dependencies.hashPassword(input.password),
      jobTitle: input.jobTitle,
      status: "active",
      createdAt: dependencies.now,
    },
    membership: {
      id: membershipId,
      organizationId: actor.organizationId,
      userId,
      role: "worker",
      status: "active",
      joinedAt: dependencies.now,
      createdByMembershipId: actor.membershipId,
      tipFactorHundredths,
    },
  });
  if (!created.created) return { ok: false as const, status: 409, error: "login_identifier_exists" };
  return { ok: true as const, status: 201, userId, displayName: normalized(input.displayName) };
}

export async function updateManagedUser(input: Omit<ManagedUserInput, "password"> & { userId: string }, actor: SessionActor, dependencies: Dependencies) {
  if (actor.role !== "admin") return { ok: false as const, status: 403, error: "admin_required" };
  const tipFactorHundredths = typeof input.tipPercentage === "number" ? input.tipPercentage : Number(input.tipPercentage);
  const displayName = normalized(input.displayName);
  const loginIdentifier = normalizeLogin(input.loginIdentifier);
  if (!USER_ID_PATTERN.test(input.userId) || displayName.length < 2 || displayName.length > 100 || !LOGIN_PATTERN.test(loginIdentifier) || !JOB_TITLES.has(input.jobTitle) || !Number.isInteger(tipFactorHundredths) || tipFactorHundredths < 1 || tipFactorHundredths > 100 || (input.jobTitle === "cashier" && tipFactorHundredths !== 50)) {
    return { ok: false as const, status: 422, error: "invalid_account_data" };
  }
  const result = await dependencies.repository.updateManagedUser({
    ...input,
    displayName,
    loginIdentifier,
    tipFactorHundredths,
    organizationId: actor.organizationId,
    actorMembershipId: actor.membershipId,
    auditId: dependencies.createId(),
    now: dependencies.now,
  });
  if (result.conflict) return { ok: false as const, status: 409, error: "login_identifier_exists" };
  if (!result.updated) return { ok: false as const, status: 404, error: "managed_user_not_found" };
  return { ok: true as const, status: 200 };
}

export async function setManagedUserStatus(input: { userId: string; status: string }, actor: SessionActor, dependencies: Dependencies) {
  if (actor.role !== "admin") return { ok: false as const, status: 403, error: "admin_required" };
  if (!USER_ID_PATTERN.test(input.userId) || !new Set(["active", "suspended"]).has(input.status)) return { ok: false as const, status: 422, error: "invalid_account_data" };
  const result = await dependencies.repository.setManagedUserStatus({ userId: input.userId, status: input.status, organizationId: actor.organizationId, actorMembershipId: actor.membershipId, auditId: dependencies.createId(), now: dependencies.now });
  if (!result.updated) return { ok: false as const, status: 404, error: "managed_user_not_found" };
  return { ok: true as const, status: 200 };
}

export async function resetManagedUserPassword(input: { userId: string; newPassword: string }, actor: SessionActor, dependencies: Dependencies) {
  if (actor.role !== "admin") return { ok: false as const, status: 403, error: "admin_required" };
  if (!USER_ID_PATTERN.test(input.userId) || typeof input.newPassword !== "string" || input.newPassword.length < 12 || input.newPassword.length > 128) return { ok: false as const, status: 422, error: "invalid_account_data" };
  const result = await dependencies.repository.resetManagedUserPassword({ userId: input.userId, organizationId: actor.organizationId, actorMembershipId: actor.membershipId, passwordHash: await dependencies.hashPassword(input.newPassword), auditId: dependencies.createId(), now: dependencies.now });
  if (!result.updated) return { ok: false as const, status: 404, error: "managed_user_not_found" };
  return { ok: true as const, status: 200 };
}

function canManageProfile(userId: string, actor: SessionActor): boolean {
  return actor.role === "admin" || actor.userId === userId;
}

export async function updateUserProfile(
  input: { userId: string; email?: unknown; phone?: unknown; bio?: unknown; hiredOn?: unknown },
  actor: SessionActor,
  dependencies: Dependencies,
) {
  if (!USER_ID_PATTERN.test(input.userId)) return { ok: false as const, status: 422, error: "invalid_profile" };
  if (!canManageProfile(input.userId, actor)) return { ok: false as const, status: 403, error: "profile_forbidden" };
  const email = normalizeLogin(input.email);
  const phone = normalized(input.phone);
  const bio = normalized(input.bio);
  const hiredOn = normalized(input.hiredOn);
  if ((email && (email.length > 254 || !EMAIL_PATTERN.test(email)))
    || (phone && !PHONE_PATTERN.test(phone))
    || bio.length > 500
    || (hiredOn && !validIsoDate(hiredOn))) {
    return { ok: false as const, status: 422, error: "invalid_profile" };
  }
  const result = await dependencies.repository.updateUserProfile({
    userId: input.userId,
    organizationId: actor.organizationId,
    actorMembershipId: actor.membershipId,
    email: email || null,
    phone: phone || null,
    bio: bio || null,
    hiredOn: hiredOn || null,
    auditId: dependencies.createId(),
    now: dependencies.now,
  });
  if (!result.updated) return { ok: false as const, status: 404, error: "profile_not_found" };
  return { ok: true as const, status: 200 };
}

export async function updateUserAvatar(
  input: { userId: string; mimeType?: unknown; base64?: unknown; remove?: unknown },
  actor: SessionActor,
  dependencies: Dependencies,
) {
  if (!USER_ID_PATTERN.test(input.userId)) return { ok: false as const, status: 422, error: "invalid_avatar" };
  if (!canManageProfile(input.userId, actor)) return { ok: false as const, status: 403, error: "profile_forbidden" };
  const remove = input.remove === true;
  const mimeType = remove ? null : normalized(input.mimeType);
  const base64 = remove ? null : normalized(input.base64);
  const decodedBytes = base64 ? Math.ceil(base64.length * 3 / 4) : 0;
  if (!remove && (!mimeType || !AVATAR_MIME_TYPES.has(mimeType) || !base64 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64) || decodedBytes > 163_840 || !validAvatarBytes(mimeType, base64))) {
    return { ok: false as const, status: 422, error: "invalid_avatar" };
  }
  const result = await dependencies.repository.updateUserAvatar({
    userId: input.userId,
    organizationId: actor.organizationId,
    actorMembershipId: actor.membershipId,
    mimeType,
    base64,
    auditId: dependencies.createId(),
    now: dependencies.now,
  });
  if (!result.updated) return { ok: false as const, status: 404, error: "profile_not_found" };
  return { ok: true as const, status: 200 };
}

export async function resetSystem(
  input: { password?: unknown; confirmation?: unknown },
  actor: SessionActor,
  dependencies: Dependencies,
) {
  if (actor.role !== "admin" || !actor.userId) return { ok: false as const, status: 403, error: "admin_required" };
  if (input.confirmation !== "ELIMINAR TODO Y REINICIAR" || typeof input.password !== "string" || input.password.length > 128) {
    return { ok: false as const, status: 422, error: "invalid_reset_confirmation" };
  }
  const credential = await dependencies.repository.findAdministratorCredential(actor.userId, actor.organizationId);
  if (!credential || !await dependencies.verifyPassword(input.password, credential.passwordHash)) {
    return { ok: false as const, status: 401, error: "invalid_reset_password" };
  }
  const result = await dependencies.repository.resetSystem({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, now: dependencies.now });
  if (!result.reset) return { ok: false as const, status: 409, error: "reset_failed" };
  return { ok: true as const, status: 200 };
}
