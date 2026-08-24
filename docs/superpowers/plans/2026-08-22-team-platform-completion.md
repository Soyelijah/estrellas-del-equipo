# Estrellas del Equipo Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure, role-separated, production-published restaurant team platform using only real D1 records.

**Architecture:** Extend the existing service/repository/Worker boundaries with scoped recovery and worker lifecycle commands, keep every privileged decision server-side, then reshape the single-page shell around role-derived navigation. Release the exact tested Worker artifact through Sites and connect the custom subdomain.

**Tech Stack:** TypeScript, React, Vinext/Vite, Cloudflare Workers, D1 SQLite, Drizzle migrations, Node test runner, ESLint, Sites, GitHub.

**Spec:** `docs/superpowers/specs/2026-08-22-team-platform-completion-design.md`

**Estado actualizado (2026-08-24):** Las tareas 1–6 fueron implementadas, verificadas, respaldadas y publicadas en `equipo.zgamersa.com`. Sus casillas se conservan como registro del plan original. La continuación funcional se documenta en la tarea 7.

## Global Constraints

- Use TDD for every behavior change and observe the intended failure before production edits.
- Never expose or log passwords, access keys, hashes, session tokens, or recovery grants.
- Keep D1 as the only authoritative store for accounts and audit history.
- Require same-origin requests plus server-side administrator authorization for every administrative mutation.
- Run the full suite before every phase completion claim and before publishing.

---

### Task 1: Secure administrator recovery

**Files:** Modify `server/setup-access.ts`, `server/admin-auth-service.ts`, `server/d1-admin-auth-repository.ts`, `server/admin-auth-http.ts`, `worker/index.ts`; test `tests/setup-access.test.mjs`, `tests/admin-auth-service.test.mjs`, `tests/admin-auth-http.test.mjs`, `tests/d1-admin-auth-repository.test.mjs`.

**Interfaces:** Produces scoped recovery grant helpers, `recoverAdministratorPassword(input, dependencies)`, repository `recoverAdministratorPassword(record)`, and `/api/auth/recovery/unlock` plus `/api/auth/recovery/complete`.

- [ ] Write service, HTTP, signing, and D1 tests proving invalid keys fail, grants expire/tamper-fail, recovery changes only the administrator hash, revokes sessions, and audits without secrets.
- [ ] Run targeted tests and confirm failures are caused by the missing recovery interfaces.
- [ ] Implement the smallest scoped grant, service command, atomic repository method, routes, cookies, and Worker wiring.
- [ ] Run targeted tests and the complete suite; require zero failures.
- [ ] Commit the independently working recovery phase.

### Task 2: Worker lifecycle administration

**Files:** Modify `server/admin-auth-service.ts`, `server/d1-admin-auth-repository.ts`, `server/admin-auth-http.ts`, `worker/index.ts`; test the corresponding service, HTTP, and D1 repository suites.

**Interfaces:** Produces `updateManagedUser`, `setManagedUserStatus`, `resetManagedUserPassword`; routes `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/status`, and `POST /api/admin/users/:id/password`.

- [ ] Write tests for valid edits, duplicate login, invalid UUID/factor/job, cross-organization access, admin-only authorization, suspension/reactivation, password reset, session revocation, and sanitized audit records.
- [ ] Run targeted tests and observe the expected missing-behavior failures.
- [ ] Implement validated service commands and atomic D1 mutations.
- [ ] Wire bounded same-origin HTTP routes and Worker dispatch.
- [ ] Run targeted tests and the complete suite; require zero failures.
- [ ] Commit the independently working worker lifecycle phase.

### Task 3: Audit read model

**Files:** Modify `server/d1-admin-auth-repository.ts`, `server/admin-auth-http.ts`, `worker/index.ts`; test repository and HTTP suites.

**Interfaces:** Produces `listAuditEvents(organizationId, limit)` and `GET /api/admin/audit` returning sanitized newest-first events.

- [ ] Write failing tests for administrator-only reads, organization scoping, bounded limits, ordering, and absence of secret fields.
- [ ] Implement the read query and HTTP response.
- [ ] Run targeted tests and the complete suite; require zero failures.
- [ ] Commit the independently working audit phase.

### Task 4: Role-separated premium interface and onboarding

**Files:** Modify `app/page.tsx`, `app/globals.css`, `app/layout.tsx`; test `tests/rendered-html.test.mjs` and HTTP-backed behavior where applicable.

**Interfaces:** Consumes auth status, worker lifecycle endpoints, recovery routes, and audit endpoint. Produces role-derived navigation, recovery UI, employee editor/status/password actions, audit timeline, and real-data onboarding checklist.

- [ ] Write rendered and behavior tests for configured-login explanation, recovery controls, admin-only navigation, worker navigation, real empty states, lifecycle controls, audit timeline, keyboard labels, and no placeholder people.
- [ ] Run tests and observe failures for missing interface behavior.
- [ ] Implement the React flows with explicit loading, success, empty, and error states.
- [ ] Apply the docket/walnut/brass design tokens, one constellation signature, responsive layouts, focus styles, and reduced-motion behavior.
- [ ] Run targeted tests, complete suite, lint, and build; require zero failures.
- [ ] Commit the independently working interface phase.

### Task 5: Security and release gate

**Files:** Modify only files required by confirmed findings; create `security_best_practices_report.md` if findings exist.

**Interfaces:** Produces a verified release candidate with no known high-severity finding in the touched authentication and administration paths.

- [ ] Enumerate request boundaries, authorization, CSRF/origin checks, cookies, runtime validation, secrets, sensitive responses, SQL binding, XSS sinks, and security headers.
- [ ] Add a failing regression test for every confirmed behavioral security defect before fixing it.
- [ ] Run `npm test`, `npm run lint`, `git diff --check`, and a local HTTP smoke test; require zero failures.
- [ ] Inspect migrations forward and rollback on a fresh SQLite database.
- [ ] Commit the verified release candidate.

### Task 6: GitHub backup and Sites production publication

**Files:** Modify `.openai/hosting.json` only when required by Sites; do not store secrets there.

**Interfaces:** Produces a private GitHub backup, a saved Sites version from the same commit, production secrets, public login access, and custom domain `equipo.zgamersa.com`.

- [ ] Create or select an empty private GitHub repository authorized to the connected account and push the verified branch without secrets.
- [ ] Configure `ADMIN_SETUP_ACCESS_KEY_HASH` as a Sites secret.
- [ ] Package and save the exact verified source as one Sites version, then deploy it for the six workers and cashier to reach the application login.
- [ ] Attach `equipo.zgamersa.com`, apply the returned DNS validation/routing records through the authorized DNS surface, and wait for active TLS.
- [ ] Verify the live root, auth status, unauthenticated mutation rejection, custom hostname, certificate, and absence of placeholder workers.
- [ ] Report the production URL and any owner-only recovery material location without printing its contents.

### Task 7: Daily evaluations and administrator-approved monthly close

**Files:** `server/evaluation-admin-service.ts`, `server/evaluation-service.ts`, `server/d1-admin-auth-repository.ts`, `server/d1-evaluation-repository.ts`, `server/admin-auth-http.ts`, `db/schema.ts`, `drizzle/0008_evaluation_shift_period.sql`, `app/page.tsx`, `app/view-model.ts`, `app/globals.css`, and their tests.

**Interfaces:** Six equally weighted dining-room criteria; daily shared-shift assignments; real monthly aggregates; completion tracking without synthetic scores; administrator-only audited close; no automatic tip-factor mutation.

- [x] Write failing tests for the six agreed criteria with equal total weight.
- [x] Implement the agreed criteria and verify the targeted HTTP suite.
- [x] Write a failing SQLite-backed test for monthly results and daily completion.
- [x] Bind every shift to its evaluation period with a reversible migration.
- [x] Aggregate each criterion equally, preserve missing days as pending, and expose results only to the administrator.
- [x] Add an administrator dashboard with monthly score, criterion detail, evidence counts, and daily completion.
- [x] Add an administrator-only audited monthly close that blocks later evaluations.
- [x] Enforce the period start/end boundary server-side.
- [x] Run the complete test, lint, migration, security, artifact, and live smoke gates.
- [x] Commit, push, save, deploy, and verify the exact release at `equipo.zgamersa.com`.
