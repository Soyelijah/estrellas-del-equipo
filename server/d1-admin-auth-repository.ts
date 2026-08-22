type PreparedStatementLike = {
  bind(...values: unknown[]): PreparedStatementLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};

type D1DatabaseLike = {
  prepare(sql: string): PreparedStatementLike;
  batch(statements: PreparedStatementLike[]): Promise<unknown>;
};

type BootstrapRecord = {
  organization: { id: string; name: string; createdAt: string } | null;
  user: { id: string; authSubject: string; displayName: string; loginIdentifier: string; passwordHash: string; status: string; createdAt: string };
  membership: { id: string; organizationId: string; userId: string; role: string; joinedAt: string };
  guard: { key: string; createdAt: string };
};

type ManagedUserRecord = {
  user: { id: string; authSubject: string; displayName: string; loginIdentifier: string; passwordHash: string; jobTitle: string; status: string; createdAt: string };
  membership: { id: string; organizationId: string; userId: string; role: string; joinedAt: string; createdByMembershipId: string; tipFactorHundredths: number };
};

function uniqueConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed|constraint failed/i.test(error.message);
}

export class D1AdminAuthRepository {
  private readonly database: D1DatabaseLike;

  constructor(database: D1DatabaseLike) {
    this.database = database;
  }

  async getBootstrapState() {
    const row = await this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM bootstrap_guards WHERE key = 'administrator_bootstrap') AS guard_count,
        (SELECT COUNT(*) FROM memberships WHERE role = 'admin' AND deleted_at IS NULL) AS admin_count,
        (SELECT COUNT(*) FROM organizations WHERE deleted_at IS NULL) AS organization_count,
        (SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1) AS organization_id
    `).first<{ guard_count: number; admin_count: number; organization_count: number; organization_id: string | null }>();

    const allowed = Boolean(row && row.guard_count === 0 && row.admin_count === 0 && row.organization_count <= 1);
    return { allowed, organizationId: allowed && row?.organization_count === 1 ? row.organization_id : null };
  }

  async saveBootstrap(rawRecord: Record<string, unknown>) {
    const record = rawRecord as unknown as BootstrapRecord;
    const statements: PreparedStatementLike[] = [];
    if (record.organization) {
      statements.push(this.database.prepare(
        "INSERT INTO organizations (id, name, timezone, status, created_at, updated_at) VALUES (?, ?, 'America/Santiago', 'active', ?, ?)",
      ).bind(record.organization.id, record.organization.name, record.organization.createdAt, record.organization.createdAt));
    }
    statements.push(
      this.database.prepare("INSERT INTO bootstrap_guards (key, created_at) VALUES (?, ?)").bind(record.guard.key, record.guard.createdAt),
      this.database.prepare(`
        INSERT INTO users (id, login_identifier, auth_subject, display_name, password_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(record.user.id, record.user.loginIdentifier, record.user.authSubject, record.user.displayName, record.user.passwordHash, record.user.createdAt, record.user.createdAt),
      this.database.prepare(`
        INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at, created_at, updated_at)
        VALUES (?, ?, ?, 'admin', 'head_waiter', ?, ?, ?)
      `).bind(record.membership.id, record.membership.organizationId, record.membership.userId, record.membership.joinedAt, record.membership.joinedAt, record.membership.joinedAt),
    );
    try {
      await this.database.batch(statements);
      return { created: true as const };
    } catch (error) {
      if (uniqueConflict(error)) return { created: false as const };
      throw error;
    }
  }

  async findLoginAccount(loginIdentifier: string) {
    return this.database.prepare(`
      SELECT u.id AS userId, u.auth_subject AS authSubject, u.display_name AS displayName,
        u.login_identifier AS loginIdentifier, u.password_hash AS passwordHash, u.status,
        m.id AS membershipId, m.organization_id AS organizationId, m.role
      FROM users u
      JOIN memberships m ON m.user_id = u.id AND m.deleted_at IS NULL
      JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL AND o.status = 'active'
      WHERE u.login_identifier = ? AND u.deleted_at IS NULL AND u.password_hash IS NOT NULL
      ORDER BY m.starts_at DESC LIMIT 1
    `).bind(loginIdentifier).first<Record<string, string>>();
  }

  async saveSession(rawRecord: Record<string, string>) {
    await this.database.prepare("INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(rawRecord.id, rawRecord.userId, rawRecord.tokenHash, rawRecord.expiresAt, rawRecord.createdAt).run();
  }

  async createManagedUser(rawRecord: Record<string, unknown>) {
    const record = rawRecord as unknown as ManagedUserRecord;
    try {
      await this.database.batch([
        this.database.prepare(`
          INSERT INTO users (id, login_identifier, auth_subject, display_name, password_hash, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `).bind(record.user.id, record.user.loginIdentifier, record.user.authSubject, record.user.displayName, record.user.passwordHash, record.user.createdAt, record.user.createdAt),
        this.database.prepare(`
          INSERT INTO memberships (id, organization_id, user_id, role, job_title, starts_at, tip_factor_hundredths, created_at, updated_at)
          VALUES (?, ?, ?, 'worker', ?, ?, ?, ?, ?)
        `).bind(record.membership.id, record.membership.organizationId, record.membership.userId, record.user.jobTitle, record.membership.joinedAt, record.membership.tipFactorHundredths, record.membership.joinedAt, record.membership.joinedAt),
        this.database.prepare(`
          INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, metadata_json, created_at)
          VALUES (?, ?, ?, 'user.created', 'user', ?, ?, ?)
        `).bind(crypto.randomUUID(), record.membership.organizationId, record.membership.createdByMembershipId, record.user.id, JSON.stringify({ jobTitle: record.user.jobTitle }), record.membership.joinedAt),
      ]);
      return { created: true as const };
    } catch (error) {
      if (uniqueConflict(error)) return { created: false as const };
      throw error;
    }
  }

  async recoverAdministratorPassword(rawRecord: Record<string, string>) {
    const account = await this.database.prepare(`
      SELECT u.id AS userId, m.organization_id AS organizationId
      FROM users u
      JOIN memberships m ON m.user_id = u.id AND m.role = 'admin' AND m.deleted_at IS NULL
      WHERE u.login_identifier = ? AND u.status = 'active' AND u.deleted_at IS NULL
      LIMIT 1
    `).bind(rawRecord.loginIdentifier).first<{ userId: string; organizationId: string }>();
    if (!account) return { updated: false as const };
    await this.database.batch([
      this.database.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
        .bind(rawRecord.passwordHash, rawRecord.now, account.userId),
      this.database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(rawRecord.now, account.userId),
      this.database.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, metadata_json, created_at)
        VALUES (?, ?, NULL, 'admin.password_recovered', 'user', ?, '{}', ?)
      `).bind(rawRecord.auditId, account.organizationId, account.userId, rawRecord.now),
    ]);
    return { updated: true as const };
  }

  async findSessionActor(tokenHash: string, now: string) {
    return this.database.prepare(`
      SELECT u.id AS userId, u.display_name AS displayName, m.role,
        m.organization_id AS organizationId, m.id AS membershipId
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id AND u.status = 'active' AND u.deleted_at IS NULL
      JOIN memberships m ON m.user_id = u.id AND m.deleted_at IS NULL
      JOIN organizations o ON o.id = m.organization_id AND o.status = 'active' AND o.deleted_at IS NULL
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      ORDER BY m.starts_at DESC LIMIT 1
    `).bind(tokenHash, now).first<{ userId: string; displayName: string; role: "admin" | "team_lead" | "worker" | "independent_reviewer"; organizationId: string; membershipId: string }>();
  }

  async revokeSession(tokenHash: string, now: string) {
    await this.database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(now, tokenHash).run();
  }

  async listOrganizationUsers(organizationId: string) {
    const rows = await this.database.prepare(`
      SELECT u.id, u.display_name AS displayName, u.login_identifier AS loginIdentifier,
        u.status, m.role, m.job_title AS jobTitle, m.tip_factor_hundredths AS tipFactorHundredths
      FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE m.organization_id = ? AND m.role <> 'admin' AND u.deleted_at IS NULL AND m.deleted_at IS NULL
      ORDER BY u.created_at, u.display_name
    `).bind(organizationId).all<{ id: string; displayName: string; loginIdentifier: string; status: string; role: string; jobTitle: string; tipFactorHundredths: number }>();
    return rows.results;
  }
}
