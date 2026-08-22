# Estrellas del Equipo: Completion Design

## Objective

Complete the existing D1-backed restaurant team application so one administrator can recover access, manage real worker accounts, review an immutable administrative audit trail, and publish the verified application at `equipo.zgamersa.com` without placeholder people or browser-owned authoritative data.

## Boundaries

- The application has exactly one administrator. Worker management never creates another administrator.
- The administrator does not participate in peer evaluations.
- The cashier can evaluate coworkers but remains excluded from being evaluated and keeps the agreed fixed factor.
- Experience factors are integer hundredths from 1 to 100 and remain weights for tip allocation, not final percentages of the pool.
- Suspensions are reversible. Accounts are not physically deleted from the UI.
- No password, access key, session token, or password hash appears in audit metadata, API responses, client storage, Git, or logs.

## Architecture

### Authentication and recovery

The existing opaque eight-hour `HttpOnly`, `SameSite=Strict` session remains the authentication boundary. A new recovery flow verifies the server-only administrator access-key hash and issues a signed, scoped, ten-minute `HttpOnly` recovery grant. The grant permits one password replacement for the existing administrator identified by login. A successful recovery revokes every active session for that administrator and writes an `admin.password_recovered` audit event in the same D1 batch.

### Administration API

All administrative mutations require a current administrator session and same-origin JSON request. The API adds operations to update worker identity/job/factor, suspend or reactivate a worker, replace a worker password, and read recent audit events. User IDs are opaque UUIDs and are validated before repository access. Repository mutations combine the business write, session revocation where applicable, and audit insert using `D1.batch`.

### Role-separated interface

The authenticated shell derives navigation from the server role. Administrators receive Inicio, Equipo, Credenciales, and Auditoría. Workers receive Inicio, Evaluaciones, and Propinas. Administrative forms are never rendered for worker accounts, while server authorization remains authoritative. Empty operational sections explain which real record must be created next.

### Onboarding

The access screen distinguishes three states: first installation, configured administrator, and signed-in account. When configured, it explicitly explains that registration is closed and provides login plus a recovery action. The admin home shows a real setup checklist derived from stored workers rather than invented completion metrics.

### Visual system

The product uses the visual language of a premium evening service: smoked walnut `#17120F`, wine `#6E2638`, docket paper `#FBF6EA`, aged brass `#C89B45`, sage confirmation `#6F8060`, and ink `#2B211C`. Display typography stays expressive and restrained; body and utility text prioritize legibility. The signature element is a seven-point service constellation that changes from quiet access atmosphere to a functional navigation marker. Motion is orchestrated at entry and interaction points, with keyboard focus, touch targets, mobile layouts, and `prefers-reduced-motion` support.

## Data model

Existing `users`, `memberships`, `auth_sessions`, and `audit_events` remain authoritative. A new reversible migration adds no destructive columns; recovery and worker lifecycle actions reuse existing status, password hash, updated timestamp, and audit structures. Audit actions are `admin.password_recovered`, `user.updated`, `user.suspended`, `user.reactivated`, and `user.password_reset`.

## Error handling

Authentication and recovery failures use generic messages that do not reveal account existence. Invalid payloads return bounded 4xx responses. Conflicts return 409. Missing or suspended sessions return 401. Non-admin actors receive 403. Unexpected storage errors produce `internal_error` without database details.

## Verification and release

Every new service behavior begins with a failing Node test. HTTP authorization and cookie behavior receive boundary tests. SQLite integration tests execute all migrations and verify atomic state/audit effects. Each module gate runs its targeted tests, then the complete build/test/lint suite. The exact verified source is backed up to a new private GitHub repository when available, saved as a Sites version, deployed, connected to `equipo.zgamersa.com`, and checked over HTTPS.
