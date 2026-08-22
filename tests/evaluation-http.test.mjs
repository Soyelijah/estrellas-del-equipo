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
