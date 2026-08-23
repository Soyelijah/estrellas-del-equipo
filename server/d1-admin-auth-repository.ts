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

  private async managedTarget(userId: string, organizationId: string) {
    return this.database.prepare(`
      SELECT u.id AS userId, m.id AS membershipId
      FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE u.id = ? AND m.organization_id = ? AND m.role <> 'admin'
        AND u.deleted_at IS NULL AND m.deleted_at IS NULL
      LIMIT 1
    `).bind(userId, organizationId).first<{ userId: string; membershipId: string }>();
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
          INSERT INTO evaluation_participations (id, period_id, membership_id, can_evaluate, can_be_evaluated, exclusion_reason, created_at, updated_at)
          SELECT ?, ep.id, ?, 1, ?, ?, ?, ?
          FROM evaluation_periods ep
          WHERE ep.organization_id = ? AND ep.status = 'open'
          ORDER BY ep.starts_at DESC
          LIMIT 1
        `).bind(
          crypto.randomUUID(),
          record.membership.id,
          record.user.jobTitle === "cashier" ? 0 : 1,
          record.user.jobTitle === "cashier" ? "fixed_tip_share" : null,
          record.membership.joinedAt,
          record.membership.joinedAt,
          record.membership.organizationId,
        ),
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

  async updateManagedUser(rawRecord: Record<string, unknown>) {
    const record = rawRecord as Record<string, string | number>;
    if (!await this.managedTarget(String(record.userId), String(record.organizationId))) return { updated: false as const, conflict: false as const };
    try {
      await this.database.batch([
        this.database.prepare("UPDATE users SET display_name = ?, login_identifier = ?, updated_at = ? WHERE id = ?")
          .bind(record.displayName, record.loginIdentifier, record.now, record.userId),
        this.database.prepare("UPDATE memberships SET job_title = ?, tip_factor_hundredths = ?, updated_at = ? WHERE user_id = ? AND organization_id = ? AND role <> 'admin'")
          .bind(record.jobTitle, record.tipFactorHundredths, record.now, record.userId, record.organizationId),
        this.database.prepare(`
          INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, metadata_json, created_at)
          VALUES (?, ?, ?, 'user.updated', 'user', ?, ?, ?)
        `).bind(record.auditId, record.organizationId, record.actorMembershipId, record.userId, JSON.stringify({ displayName: record.displayName, loginIdentifier: record.loginIdentifier, jobTitle: record.jobTitle, tipFactorHundredths: record.tipFactorHundredths }), record.now),
      ]);
      return { updated: true as const, conflict: false as const };
    } catch (error) {
      if (uniqueConflict(error)) return { updated: false as const, conflict: true as const };
      throw error;
    }
  }

  async setManagedUserStatus(rawRecord: Record<string, string>) {
    if (!await this.managedTarget(rawRecord.userId, rawRecord.organizationId)) return { updated: false as const };
    const storedStatus = rawRecord.status === "suspended" ? "disabled" : "active";
    const statements = [
      this.database.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").bind(storedStatus, rawRecord.now, rawRecord.userId),
      this.database.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, 'user', ?, '{}', ?)
      `).bind(rawRecord.auditId, rawRecord.organizationId, rawRecord.actorMembershipId, rawRecord.status === "active" ? "user.reactivated" : "user.suspended", rawRecord.userId, rawRecord.now),
    ];
    if (rawRecord.status === "suspended") statements.splice(1, 0, this.database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(rawRecord.now, rawRecord.userId));
    await this.database.batch(statements);
    return { updated: true as const };
  }

  async resetManagedUserPassword(rawRecord: Record<string, string>) {
    if (!await this.managedTarget(rawRecord.userId, rawRecord.organizationId)) return { updated: false as const };
    await this.database.batch([
      this.database.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(rawRecord.passwordHash, rawRecord.now, rawRecord.userId),
      this.database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(rawRecord.now, rawRecord.userId),
      this.database.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, metadata_json, created_at)
        VALUES (?, ?, ?, 'user.password_reset', 'user', ?, '{}', ?)
      `).bind(rawRecord.auditId, rawRecord.organizationId, rawRecord.actorMembershipId, rawRecord.userId, rawRecord.now),
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

  async getEvaluationOperations(organizationId: string) {
    const [period, members, shifts] = await Promise.all([
      this.database.prepare(`
        SELECT ep.id, ep.name, ep.starts_at AS startsAt, ep.ends_at AS endsAt, ep.status,
          (SELECT COUNT(*) FROM evaluation_submissions es WHERE es.period_id = ep.id AND es.status <> 'voided') AS submissionCount
        FROM evaluation_periods ep
        WHERE ep.organization_id = ? AND ep.status = 'open'
        ORDER BY ep.starts_at DESC LIMIT 1
      `).bind(organizationId).first<Record<string, unknown>>(),
      this.database.prepare(`
        SELECT m.id AS membershipId, u.display_name AS displayName, m.job_title AS jobTitle, u.status,
          CASE WHEN u.status = 'active' THEN 1 ELSE 0 END AS canEvaluate,
          CASE WHEN u.status = 'active' AND m.job_title <> 'cashier' THEN 1 ELSE 0 END AS canBeEvaluated
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ? AND m.role <> 'admin' AND m.deleted_at IS NULL AND u.deleted_at IS NULL
        ORDER BY u.display_name
      `).bind(organizationId).all<Record<string, unknown>>(),
      this.database.prepare(`
        SELECT s.id, s.starts_at AS startsAt, s.ends_at AS endsAt, s.section, s.status,
          COUNT(sa.id) AS memberCount
        FROM shifts s
        LEFT JOIN shift_assignments sa ON sa.shift_id = s.id
        WHERE s.organization_id = ?
        GROUP BY s.id
        ORDER BY s.starts_at DESC
        LIMIT 20
      `).bind(organizationId).all<Record<string, unknown>>(),
    ]);
    return {
      period,
      members: members.results.map((member) => ({ ...member, canEvaluate: member.canEvaluate === 1, canBeEvaluated: member.canBeEvaluated === 1 })),
      shifts: shifts.results,
    };
  }

  async openEvaluationCycle(rawRecord: Record<string, unknown>) {
    const record = rawRecord as Record<string, unknown> & {
      organizationId: string;
      createdByMembershipId: string;
      policyId: string;
      periodId: string;
      auditId: string;
      name: string;
      startsAt: string;
      endsAt: string;
      now: string;
      criteria: Array<{ id: string; code: string; name: string; description: string; category: string; weightBasisPoints: number }>;
    };
    const existing = await this.database.prepare("SELECT id FROM evaluation_periods WHERE organization_id = ? AND status = 'open' LIMIT 1")
      .bind(record.organizationId).first<{ id: string }>();
    if (existing) return { created: false as const, reason: "open_cycle_exists" };

    const members = await this.database.prepare(`
      SELECT m.id, m.job_title
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? AND m.role <> 'admin' AND m.deleted_at IS NULL
        AND u.status = 'active' AND u.deleted_at IS NULL
    `).bind(record.organizationId).all<{ id: string; job_title: string }>();
    if (members.results.length < 2) return { created: false as const, reason: "insufficient_workers" };

    const versionRow = await this.database.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM policy_versions WHERE organization_id = ?")
      .bind(record.organizationId).first<{ version: number }>();
    const statements = [
      this.database.prepare(`
        INSERT INTO policy_versions (id, organization_id, version, effective_from, status, minimum_raters, minimum_shifts, created_by_membership_id, created_at)
        VALUES (?, ?, ?, ?, 'active', 2, 1, ?, ?)
      `).bind(record.policyId, record.organizationId, versionRow?.version ?? 1, record.startsAt, record.createdByMembershipId, record.now),
      ...record.criteria.map((criterion) => this.database.prepare(`
        INSERT INTO criteria (id, policy_version_id, code, name, description, category, applicable_job_title, measurement_type, weight_basis_points, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 'peer_rating', ?, ?)
      `).bind(criterion.id, record.policyId, criterion.code, criterion.name, criterion.description, criterion.category, criterion.weightBasisPoints, record.now)),
      this.database.prepare(`
        INSERT INTO evaluation_periods (id, organization_id, policy_version_id, name, starts_at, ends_at, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
      `).bind(record.periodId, record.organizationId, record.policyId, record.name, record.startsAt, record.endsAt, record.now),
      ...members.results.map((member) => this.database.prepare(`
        INSERT INTO evaluation_participations (id, period_id, membership_id, can_evaluate, can_be_evaluated, exclusion_reason, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        record.periodId,
        member.id,
        member.job_title === "cashier" ? 0 : 1,
        member.job_title === "cashier" ? "fixed_tip_share" : null,
        record.now,
        record.now,
      )),
      this.database.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, metadata_json, created_at)
        VALUES (?, ?, ?, 'evaluation.cycle_opened', 'evaluation_period', ?, ?, ?)
      `).bind(record.auditId, record.organizationId, record.createdByMembershipId, record.periodId, JSON.stringify({ name: record.name }), record.now),
    ];
    await this.database.batch(statements);
    return { created: true as const };
  }

  async createEvaluationShift(rawRecord: Record<string, unknown>) {
    const record = rawRecord as Record<string, unknown> & {
      id: string;
      auditId: string;
      organizationId: string;
      createdByMembershipId: string;
      section: string;
      startsAt: string;
      endsAt: string;
      membershipIds: string[];
      now: string;
    };
    const period = await this.database.prepare("SELECT id FROM evaluation_periods WHERE organization_id = ? AND status = 'open' ORDER BY starts_at DESC LIMIT 1")
      .bind(record.organizationId).first<{ id: string }>();
    if (!period) return { created: false as const, reason: "evaluation_cycle_required" };

    const placeholders = record.membershipIds.map(() => "?").join(", ");
    const members = await this.database.prepare(`
      SELECT m.id, m.job_title
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN evaluation_participations ep ON ep.membership_id = m.id AND ep.period_id = ? AND ep.can_evaluate = 1
      WHERE m.organization_id = ? AND m.role <> 'admin' AND m.id IN (${placeholders})
        AND m.deleted_at IS NULL AND u.status = 'active' AND u.deleted_at IS NULL
    `).bind(period.id, record.organizationId, ...record.membershipIds).all<{ id: string; job_title: string }>();
    if (members.results.length !== record.membershipIds.length) return { created: false as const, reason: "invalid_shift_members" };

    await this.database.batch([
      this.database.prepare(`
        INSERT INTO shifts (id, organization_id, starts_at, ends_at, section, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'closed', ?)
      `).bind(record.id, record.organizationId, record.startsAt, record.endsAt, record.section, record.now),
      ...members.results.map((member) => this.database.prepare(`
        INSERT INTO shift_assignments (id, shift_id, membership_id, role_during_shift, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), record.id, member.id, member.job_title, record.now)),
      this.database.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, metadata_json, created_at)
        VALUES (?, ?, ?, 'evaluation.shift_recorded', 'shift', ?, ?, ?)
      `).bind(record.auditId, record.organizationId, record.createdByMembershipId, record.id, JSON.stringify({ section: record.section, memberCount: members.results.length }), record.now),
    ]);
    return { created: true as const };
  }

  async listAuditEvents(organizationId: string, limit: number) {
    const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const rows = await this.database.prepare(`
      SELECT a.id, a.action, a.object_type AS objectType, a.object_id AS objectId,
        a.reason, a.metadata_json AS metadataJson, a.created_at AS createdAt,
        actor.display_name AS actorDisplayName
      FROM audit_events a
      LEFT JOIN memberships actor_membership ON actor_membership.id = a.actor_membership_id
      LEFT JOIN users actor ON actor.id = actor_membership.user_id
      WHERE a.organization_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `).bind(organizationId, boundedLimit).all<{ id: string; action: string; objectType: string; objectId: string; reason: string | null; metadataJson: string; createdAt: string; actorDisplayName: string | null }>();
    return rows.results.map(({ metadataJson, ...event }) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(metadataJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        metadata = {};
      }
      return { ...event, metadata };
    });
  }
}
