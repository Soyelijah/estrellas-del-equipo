import assert from "node:assert/strict";
import test from "node:test";

import { readAuthenticatedIdentity } from "../domain/identity.ts";
import { authorizeMembership } from "../domain/access-control.ts";

test("rejects an email header without the stable authenticated subject", () => {
  const headers = new Headers({
    "oai-authenticated-user-email": "garzon1@example.com",
  });

  assert.equal(readAuthenticatedIdentity(headers), null);
});

test("reads a stable authenticated identity and safely decodes its display name", () => {
  const headers = new Headers({
    "oai-authenticated-user-id": "site-user-123",
    "oai-authenticated-user-email": "Garzon1@Example.com",
    "oai-authenticated-user-full-name": "Garz%C3%B3n%201",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });

  assert.deepEqual(readAuthenticatedIdentity(headers), {
    subjectId: "site-user-123",
    email: "garzon1@example.com",
    displayName: "Garzón 1",
  });
});

test("does not decode a display name when the encoding marker is absent", () => {
  const headers = new Headers({
    "oai-authenticated-user-id": "site-user-123",
    "oai-authenticated-user-email": "garzon1@example.com",
    "oai-authenticated-user-full-name": "Nombre%20Forjado",
  });

  assert.deepEqual(readAuthenticatedIdentity(headers), {
    subjectId: "site-user-123",
    email: "garzon1@example.com",
    displayName: "garzon1@example.com",
  });
});

const validAuthorization = {
  identity: {
    subjectId: "site-user-123",
    email: "garzon1@example.com",
    displayName: "Garzón 1",
  },
  user: {
    id: "user-1",
    authSubject: "site-user-123",
    status: "active",
    deletedAt: null,
  },
  membership: {
    id: "membership-1",
    userId: "user-1",
    organizationId: "restaurant-1",
    role: "worker",
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: null,
    deletedAt: null,
  },
  organization: {
    id: "restaurant-1",
    status: "active",
    deletedAt: null,
  },
  now: "2026-08-15T12:00:00.000Z",
};

test("rejects a request without an authenticated identity", () => {
  assert.deepEqual(
    authorizeMembership({ ...validAuthorization, identity: null }),
    { ok: false, status: 401, reason: "authentication_required" },
  );
});

test("derives the active actor membership from the authenticated subject", () => {
  assert.deepEqual(authorizeMembership(validAuthorization), {
    ok: true,
    actor: {
      userId: "user-1",
      membershipId: "membership-1",
      organizationId: "restaurant-1",
      role: "worker",
    },
  });
});

test("rejects a database user that does not match the authenticated subject", () => {
  const result = authorizeMembership({
    ...validAuthorization,
    user: { ...validAuthorization.user, authSubject: "different-subject" },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    reason: "identity_mismatch",
  });
});

test("rejects locked or deleted users", () => {
  const locked = authorizeMembership({
    ...validAuthorization,
    user: { ...validAuthorization.user, status: "locked" },
  });
  const deleted = authorizeMembership({
    ...validAuthorization,
    user: { ...validAuthorization.user, deletedAt: "2026-08-10T00:00:00.000Z" },
  });

  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "user_inactive");
  assert.equal(deleted.ok, false);
  assert.equal(deleted.reason, "user_inactive");
});

test("rejects a membership that is expired or belongs to another user", () => {
  const expired = authorizeMembership({
    ...validAuthorization,
    membership: {
      ...validAuthorization.membership,
      endsAt: "2026-08-14T23:59:59.000Z",
    },
  });
  const crossUser = authorizeMembership({
    ...validAuthorization,
    membership: { ...validAuthorization.membership, userId: "user-2" },
  });

  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "membership_inactive");
  assert.equal(crossUser.ok, false);
  assert.equal(crossUser.reason, "membership_mismatch");
});

test("rejects suspended or mismatched organizations", () => {
  const suspended = authorizeMembership({
    ...validAuthorization,
    organization: { ...validAuthorization.organization, status: "suspended" },
  });
  const mismatched = authorizeMembership({
    ...validAuthorization,
    organization: { ...validAuthorization.organization, id: "restaurant-2" },
  });

  assert.equal(suspended.ok, false);
  assert.equal(suspended.reason, "organization_inactive");
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.reason, "organization_mismatch");
});
