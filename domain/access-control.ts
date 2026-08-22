import type { AuthenticatedIdentity } from "./identity";

type UserRecord = {
  id: string;
  authSubject: string | null;
  status: string;
  deletedAt: string | null;
};

type MembershipRecord = {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  startsAt: string;
  endsAt: string | null;
  deletedAt: string | null;
};

type OrganizationRecord = {
  id: string;
  status: string;
  deletedAt: string | null;
};

type AuthorizationInput = {
  identity: AuthenticatedIdentity | null;
  user: UserRecord | null;
  membership: MembershipRecord | null;
  organization: OrganizationRecord | null;
  now: string;
};

export type AuthorizedActor = {
  userId: string;
  membershipId: string;
  organizationId: string;
  role: string;
};

type AuthorizationResult =
  | { ok: true; actor: AuthorizedActor }
  | {
      ok: false;
      status: 401 | 403;
      reason:
        | "authentication_required"
        | "identity_mismatch"
        | "user_inactive"
        | "membership_inactive"
        | "membership_mismatch"
        | "organization_inactive"
        | "organization_mismatch";
    };

export function authorizeMembership(
  input: AuthorizationInput,
): AuthorizationResult {
  if (!input.identity) {
    return { ok: false, status: 401, reason: "authentication_required" };
  }

  if (!input.user || input.user.authSubject !== input.identity.subjectId) {
    return { ok: false, status: 403, reason: "identity_mismatch" };
  }

  if (input.user.status !== "active" || input.user.deletedAt) {
    return { ok: false, status: 403, reason: "user_inactive" };
  }

  if (!input.membership || input.membership.userId !== input.user.id) {
    return { ok: false, status: 403, reason: "membership_mismatch" };
  }

  if (
    input.membership.deletedAt ||
    input.now < input.membership.startsAt ||
    (input.membership.endsAt !== null && input.now > input.membership.endsAt)
  ) {
    return { ok: false, status: 403, reason: "membership_inactive" };
  }

  if (
    !input.organization ||
    input.organization.id !== input.membership.organizationId
  ) {
    return { ok: false, status: 403, reason: "organization_mismatch" };
  }

  if (input.organization.status !== "active" || input.organization.deletedAt) {
    return { ok: false, status: 403, reason: "organization_inactive" };
  }

  return {
    ok: true,
    actor: {
      userId: input.user.id,
      membershipId: input.membership.id,
      organizationId: input.organization.id,
      role: input.membership.role,
    },
  };
}
