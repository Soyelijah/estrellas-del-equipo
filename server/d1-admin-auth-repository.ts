import { carryForwardDailyScores } from "../domain/monthly-evaluation.ts";

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

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
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
    const period = await this.database.prepare(`
      SELECT ep.id, ep.name, ep.starts_at AS startsAt, ep.ends_at AS endsAt, ep.status,
        (SELECT COUNT(*) FROM evaluation_submissions es WHERE es.period_id = ep.id AND es.status <> 'voided') AS submissionCount
      FROM evaluation_periods ep
      WHERE ep.organization_id = ? AND ep.status IN ('open', 'under_review', 'published')
      ORDER BY CASE ep.status WHEN 'open' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, ep.starts_at DESC LIMIT 1
    `).bind(organizationId).first<Record<string, unknown>>();

    const [members, shifts] = await Promise.all([
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

    let summary: Record<string, unknown> | null = null;
    if (period) {
      const periodId = String(period.id);
      const [dailyRows, resultRows, criterionRows, subjectDailyRows, cycleCriteriaRows] = await Promise.all([
        this.database.prepare(`
          SELECT substr(s.starts_at, 1, 10) AS serviceDate,
            COUNT(*) AS expectedSubmissions,
            SUM(CASE WHEN es.id IS NULL THEN 0 ELSE 1 END) AS completedSubmissions
          FROM shifts s
          JOIN shift_assignments rater_assignment ON rater_assignment.shift_id = s.id
          JOIN evaluation_participations rater_participation
            ON rater_participation.period_id = ?
            AND rater_participation.membership_id = rater_assignment.membership_id
            AND rater_participation.can_evaluate = 1
          JOIN shift_assignments subject_assignment
            ON subject_assignment.shift_id = s.id
            AND subject_assignment.membership_id <> rater_assignment.membership_id
          JOIN evaluation_participations subject_participation
            ON subject_participation.period_id = ?
            AND subject_participation.membership_id = subject_assignment.membership_id
            AND subject_participation.can_be_evaluated = 1
          LEFT JOIN evaluation_submissions es
            ON es.period_id = ?
            AND es.shift_id = s.id
            AND es.rater_membership_id = rater_assignment.membership_id
            AND es.subject_membership_id = subject_assignment.membership_id
            AND es.status <> 'voided'
          WHERE s.organization_id = ? AND s.period_id = ? AND s.status = 'closed'
          GROUP BY substr(s.starts_at, 1, 10)
          ORDER BY serviceDate
        `).bind(periodId, periodId, periodId, organizationId, periodId).all<{
          serviceDate: string;
          expectedSubmissions: number;
          completedSubmissions: number;
        }>(),
        this.database.prepare(`
          SELECT p.membership_id AS membershipId, u.display_name AS displayName, m.job_title AS jobTitle,
            COUNT(DISTINCT es.id) AS completedSubmissions,
            COUNT(DISTINCT es.rater_membership_id) AS independentRaters,
            COUNT(DISTINCT substr(s.starts_at, 1, 10)) AS evaluatedDays
          FROM evaluation_participations p
          JOIN memberships m ON m.id = p.membership_id AND m.organization_id = ?
          JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
          LEFT JOIN evaluation_submissions es
            ON es.period_id = p.period_id AND es.subject_membership_id = p.membership_id AND es.status <> 'voided'
          LEFT JOIN shifts s ON s.id = es.shift_id
          WHERE p.period_id = ? AND p.can_be_evaluated = 1
          GROUP BY p.membership_id, u.display_name, m.job_title
          ORDER BY u.display_name
        `).bind(organizationId, periodId).all<{
          membershipId: string;
          displayName: string;
          jobTitle: string;
          completedSubmissions: number;
          independentRaters: number;
          evaluatedDays: number;
        }>(),
        this.database.prepare(`
          SELECT p.membership_id AS membershipId, c.id AS criterionId, c.name,
            AVG(CASE WHEN ro.response_status = 'rated' THEN ro.value END) AS score
          FROM evaluation_participations p
          JOIN evaluation_periods ep ON ep.id = p.period_id
          JOIN criteria c ON c.policy_version_id = ep.policy_version_id AND c.measurement_type = 'peer_rating'
          LEFT JOIN evaluation_submissions es
            ON es.period_id = p.period_id AND es.subject_membership_id = p.membership_id AND es.status <> 'voided'
          LEFT JOIN rating_observations ro
            ON ro.submission_id = es.id AND ro.criterion_id = c.id
          WHERE p.period_id = ? AND p.can_be_evaluated = 1
          GROUP BY p.membership_id, c.id, c.name, c.created_at
          ORDER BY p.membership_id, c.created_at, c.id
        `).bind(periodId).all<{ membershipId: string; criterionId: string; name: string; score: number | null }>(),
        this.database.prepare(`
          SELECT p.membership_id AS membershipId,
            substr(s.starts_at, 1, 10) AS serviceDate,
            AVG(CASE WHEN ro.response_status = 'rated' THEN ro.value END) AS actualScore
          FROM evaluation_participations p
          JOIN shift_assignments subject_assignment
            ON subject_assignment.membership_id = p.membership_id
          JOIN shifts s
            ON s.id = subject_assignment.shift_id
            AND s.period_id = p.period_id
            AND s.organization_id = ?
            AND s.status = 'closed'
          LEFT JOIN evaluation_submissions es
            ON es.period_id = p.period_id
            AND es.shift_id = s.id
            AND es.subject_membership_id = p.membership_id
            AND es.status <> 'voided'
          LEFT JOIN rating_observations ro ON ro.submission_id = es.id
          WHERE p.period_id = ? AND p.can_be_evaluated = 1
          GROUP BY p.membership_id, substr(s.starts_at, 1, 10)
          ORDER BY p.membership_id, serviceDate
        `).bind(organizationId, periodId).all<{
          membershipId: string;
          serviceDate: string;
          actualScore: number | null;
        }>(),
        this.database.prepare(`
          SELECT c.id, c.name, c.description, c.weight_basis_points AS weightBasisPoints
          FROM criteria c
          JOIN evaluation_periods ep ON ep.policy_version_id = c.policy_version_id
          WHERE ep.id = ? AND c.measurement_type = 'peer_rating'
          ORDER BY c.created_at, c.id
        `).bind(periodId).all<{
          id: string;
          name: string;
          description: string;
          weightBasisPoints: number;
        }>(),
      ]);

      const daily = dailyRows.results.map((row) => ({
        serviceDate: row.serviceDate,
        completedSubmissions: Number(row.completedSubmissions),
        expectedSubmissions: Number(row.expectedSubmissions),
      }));
      const expectedSubmissions = daily.reduce((total, row) => total + row.expectedSubmissions, 0);
      const completedSubmissions = daily.reduce((total, row) => total + row.completedSubmissions, 0);
      const results = resultRows.results.map((row) => {
        const criteria = criterionRows.results
          .filter((criterion) => criterion.membershipId === row.membershipId)
          .map((criterion) => ({
            criterionId: criterion.criterionId,
            name: criterion.name,
            score: criterion.score === null ? null : roundScore(Number(criterion.score)),
          }));
        const monthlyScores = carryForwardDailyScores(
          subjectDailyRows.results
            .filter((dailyScore) => dailyScore.membershipId === row.membershipId)
            .map((dailyScore) => ({
              serviceDate: dailyScore.serviceDate,
              actualScore: dailyScore.actualScore === null ? null : Number(dailyScore.actualScore),
            })),
        );
        return {
          ...row,
          completedSubmissions: Number(row.completedSubmissions),
          independentRaters: Number(row.independentRaters),
          evaluatedDays: Number(row.evaluatedDays),
          score: monthlyScores.score,
          actualScore: monthlyScores.actualScore,
          estimatedDays: monthlyScores.estimatedDays,
          unscoredDays: monthlyScores.unscoredDays,
          dailyScores: monthlyScores.dailyScores,
          criteria,
        };
      });
      summary = {
        periodId,
        completedSubmissions,
        expectedSubmissions,
        completionPercent: expectedSubmissions === 0 ? 0 : Math.round((completedSubmissions / expectedSubmissions) * 100),
        daily,
        results,
      };
      return {
        period,
        members: members.results.map((member) => ({ ...member, canEvaluate: member.canEvaluate === 1, canBeEvaluated: member.canBeEvaluated === 1 })),
        shifts: shifts.results,
        criteria: cycleCriteriaRows.results,
        summary,
      };
    }
    return {
      period,
      members: members.results.map((member) => ({ ...member, canEvaluate: member.canEvaluate === 1, canBeEvaluated: member.canBeEvaluated === 1 })),
      shifts: shifts.results,
      criteria: [],
      summary,
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
    const period = await this.database.prepare("SELECT id, starts_at, ends_at FROM evaluation_periods WHERE organization_id = ? AND status = 'open' ORDER BY starts_at DESC LIMIT 1")
      .bind(record.organizationId).first<{ id: string; starts_at: string; ends_at: string }>();
    if (!period) return { created: false as const, reason: "evaluation_cycle_required" };
    if (record.startsAt < period.starts_at || record.endsAt > period.ends_at) {
      return { created: false as const, reason: "shift_outside_cycle" };
    }

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
        INSERT INTO shifts (id, organization_id, period_id, starts_at, ends_at, section, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'closed', ?)
      `).bind(record.id, record.organizationId, period.id, record.startsAt, record.endsAt, record.section, record.now),
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

  async closeEvaluationCycle(rawRecord: Record<string, unknown>) {
    const record = rawRecord as Record<string, string>;
    const period = await this.database.prepare(`
      SELECT id FROM evaluation_periods
      WHERE id = ? AND organization_id = ? AND status = 'open'
      LIMIT 1
    `).bind(record.periodId, record.organizationId).first<{ id: string }>();
    if (!period) return { updated: false as const };
    await this.database.batch([
      this.database.prepare(`
        UPDATE evaluation_periods SET status = 'under_review'
        WHERE id = ? AND organization_id = ? AND status = 'open'
      `).bind(record.periodId, record.organizationId),
      this.database.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, reason, metadata_json, created_at)
        VALUES (?, ?, ?, 'evaluation.cycle_closed', 'evaluation_period', ?, ?, '{}', ?)
      `).bind(record.auditId, record.organizationId, record.actorMembershipId, record.periodId, record.reason, record.now),
    ]);
    return { updated: true as const };
  }

  async deleteEvaluationCycle(rawRecord: Record<string, unknown>) {
    const record = rawRecord as Record<string, string>;
    const period = await this.database.prepare(`
      SELECT id, policy_version_id AS policyId, name
      FROM evaluation_periods
      WHERE id = ? AND organization_id = ? AND status IN ('open', 'under_review')
      LIMIT 1
    `).bind(record.periodId, record.organizationId).first<{ id: string; policyId: string; name: string }>();
    if (!period) return { deleted: false as const };

    await this.database.batch([
      this.database.prepare(`
        DELETE FROM review_requests
        WHERE organization_id = ? AND (
          (object_type = 'evaluation_period' AND object_id = ?)
          OR (object_type = 'result_snapshot' AND object_id IN (
            SELECT id FROM result_snapshots WHERE period_id = ?
          ))
        )
      `).bind(record.organizationId, period.id, period.id),
      this.database.prepare("DELETE FROM integrity_alerts WHERE organization_id = ? AND period_id = ?")
        .bind(record.organizationId, period.id),
      this.database.prepare("DELETE FROM result_snapshots WHERE organization_id = ? AND period_id = ?")
        .bind(record.organizationId, period.id),
      this.database.prepare(`
        DELETE FROM rating_observations
        WHERE submission_id IN (
          SELECT id FROM evaluation_submissions WHERE organization_id = ? AND period_id = ?
        )
      `).bind(record.organizationId, period.id),
      this.database.prepare("DELETE FROM evaluation_submissions WHERE organization_id = ? AND period_id = ?")
        .bind(record.organizationId, period.id),
      this.database.prepare(`
        DELETE FROM shift_assignments
        WHERE shift_id IN (
          SELECT id FROM shifts WHERE organization_id = ? AND period_id = ?
        )
      `).bind(record.organizationId, period.id),
      this.database.prepare("DELETE FROM shifts WHERE organization_id = ? AND period_id = ?")
        .bind(record.organizationId, period.id),
      this.database.prepare("DELETE FROM evaluation_participations WHERE period_id = ?")
        .bind(period.id),
      this.database.prepare("DELETE FROM evaluation_periods WHERE id = ? AND organization_id = ?")
        .bind(period.id, record.organizationId),
      this.database.prepare(`
        DELETE FROM policy_versions
        WHERE id = ? AND organization_id = ?
          AND NOT EXISTS (SELECT 1 FROM evaluation_periods WHERE policy_version_id = ?)
      `).bind(period.policyId, record.organizationId, period.policyId),
      this.database.prepare(`
        INSERT INTO audit_events (id, organization_id, actor_membership_id, action, object_type, object_id, reason, metadata_json, created_at)
        VALUES (?, ?, ?, 'evaluation.cycle_deleted', 'evaluation_period', ?, ?, ?, ?)
      `).bind(
        record.auditId,
        record.organizationId,
        record.actorMembershipId,
        period.id,
        record.reason,
        JSON.stringify({ deletedCycleName: period.name, policyVersionId: period.policyId }),
        record.now,
      ),
    ]);
    return { deleted: true as const };
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
