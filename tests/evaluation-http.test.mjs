import assert from "node:assert/strict";
import test from "node:test";

import { handleEvaluationRequest } from "../server/evaluation-http.ts";

function request(body, headers = {}) {
  return new Request("https://equipo.example/api/evaluations", {
    method: "POST",
    headers: {
      origin: "https://equipo.example",
      "content-type": "application/json",
      "oai-authenticated-user-id": "site-user-123",
      "oai-authenticated-user-email": "garzon1@example.com",
      ...headers,
    },
    body,
  });
}

test("rejects cross-origin evaluation requests before touching the repository", async () => {
  let reads = 0;
  const response = await handleEvaluationRequest(
    request("{}", { origin: "https://evil.example" }),
    {
      repository: {
        async findAuthorizationContext() { reads += 1; return null; },
        async findSubmissionEvidence() { return null; },
        async saveSubmission() { return { created: true }; },
      },
      createId: () => "unused",
      now: () => "2026-08-15T12:00:00.000Z",
    },
  );

  assert.equal(response.status, 403);
  assert.equal(reads, 0);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "cross_origin_request",
  });
});

test("returns a no-store JSON response for unauthenticated requests", async () => {
  const response = await handleEvaluationRequest(
    request("{}", {
      "oai-authenticated-user-id": "",
      "oai-authenticated-user-email": "",
    }),
    {
      repository: null,
      createId: () => "unused",
      now: () => "2026-08-15T12:00:00.000Z",
    },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "authentication_required",
  });
});

test("rejects invalid JSON without exposing parser details", async () => {
  const response = await handleEvaluationRequest(request("{"), {
    repository: null,
    createId: () => "unused",
    now: () => "2026-08-15T12:00:00.000Z",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_json" });
});

test("loads a worker's real evaluation workspace from their password session", async () => {
  const workspace = {
    period: { id: "period-1", name: "Servicio agosto", endsAt: "2026-08-31T23:59:59.000Z" },
    criteria: [{ id: "criterion-1", name: "Trabajo en equipo", description: "Coopera durante el turno", category: "teamwork" }],
    assignments: [{ shiftId: "shift-1", startsAt: "2026-08-22T18:00:00.000Z", endsAt: "2026-08-23T02:00:00.000Z", section: "Salón", subjectMembershipId: "membership-2", subjectDisplayName: "Compañero", subjectJobTitle: "waiter" }],
  };
  const response = await handleEvaluationRequest(
    new Request("https://equipo.example/api/evaluations", { headers: { cookie: "estrellas_session=private-cookie-token" } }),
    {
      repository: {
        async findAuthorizationContext(subjectId) {
          assert.equal(subjectId, "local:user-1");
          return {
            user: { id: "user-1", authSubject: "local:user-1", status: "active", deletedAt: null },
            membership: { id: "membership-1", userId: "user-1", organizationId: "org-1", role: "worker", startsAt: "2026-08-01T00:00:00.000Z", endsAt: null, deletedAt: null },
            organization: { id: "org-1", status: "active", deletedAt: null },
          };
        },
        async loadWorkspace(actor) { assert.equal(actor.membershipId, "membership-1"); return workspace; },
        async findSubmissionEvidence() { return null; },
        async saveSubmission() { return { created: true }; },
      },
      resolveIdentity: async () => ({ subjectId: "local:user-1", email: "user-1@local.invalid", displayName: "Trabajador" }),
      createId: () => "unused",
      now: () => "2026-08-23T12:00:00.000Z",
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, workspace });
});

test("submits an evaluation using the password session identity instead of platform headers", async () => {
  const response = await handleEvaluationRequest(
    new Request("https://equipo.example/api/evaluations", {
      method: "POST",
      headers: { origin: "https://equipo.example", "content-type": "application/json", cookie: "estrellas_session=private-cookie-token" },
      body: JSON.stringify({ periodId: "period-1", shiftId: "shift-1", subjectMembershipId: "membership-2", ratings: [{ criterionId: "criterion-1", responseStatus: "rated", value: 5 }, { criterionId: "criterion-2", responseStatus: "rated", value: 4 }] }),
    }),
    {
      repository: {
        async findAuthorizationContext() { return { user: { id: "user-1", authSubject: "local:user-1", status: "active", deletedAt: null }, membership: { id: "membership-1", userId: "user-1", organizationId: "org-1", role: "worker", startsAt: "2026-08-01T00:00:00.000Z", endsAt: null, deletedAt: null }, organization: { id: "org-1", status: "active", deletedAt: null } }; },
        async loadWorkspace() { return { period: null, criteria: [], assignments: [] }; },
        async findSubmissionEvidence() { return { subjectOrganizationId: "org-1", sharedShift: true, periodOpen: true, alreadySubmitted: false, raterCanEvaluate: true, subjectCanBeEvaluated: true, validCriterionIds: ["criterion-1", "criterion-2"] }; },
        async saveSubmission() { return { created: true }; },
      },
      resolveIdentity: async () => ({ subjectId: "local:user-1", email: "user-1@local.invalid", displayName: "Trabajador" }),
      createId: (() => { let value = 0; return () => `id-${++value}`; })(),
      now: () => "2026-08-23T12:00:00.000Z",
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, status: 201, submissionId: "id-1" });
});
