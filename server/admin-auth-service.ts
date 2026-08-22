type Role = "admin" | "team_lead" | "worker" | "independent_reviewer";
type JobTitle = "head_waiter" | "waiter" | "bartender" | "cashier";

type AccountInput = {
  displayName: string;
  loginIdentifier: string;
  password: string;
};

type BootstrapInput = AccountInput & { organizationName: string };
type ManagedUserInput = AccountInput & { jobTitle: JobTitle; tipPercentage: string | number };

type SessionActor = { role: Role; organizationId: string; membershipId: string };

type Dependencies = {
  repository: {
    getBootstrapState(): Promise<{ allowed: boolean; organizationId: string | null }>;
    saveBootstrap(record: Record<string, unknown>): Promise<{ created: boolean }>;
    findLoginAccount(loginIdentifier: string): Promise<Record<string, string> | null>;
    saveSession(record: Record<string, string>): Promise<void>;
    createManagedUser(record: Record<string, unknown>): Promise<{ created: boolean }>;
    recoverAdministratorPassword(record: Record<string, string>): Promise<{ updated: boolean }>;
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

function normalized(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function normalizeLogin(value: unknown): string {
  return normalized(value).toLocaleLowerCase("es-CL");
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
  if (!validAccount(input) || !JOB_TITLES.has(input.jobTitle) || !Number.isInteger(tipFactorHundredths) || tipFactorHundredths < 1 || tipFactorHundredths > 100) {
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
