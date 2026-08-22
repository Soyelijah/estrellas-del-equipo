import { readAuthenticatedIdentity } from "../domain/identity.ts";
import {
  submitEvaluation,
  type EvaluationRepository,
} from "./evaluation-service.ts";
import { isSameOriginMutation } from "./request-security.ts";

const MAX_JSON_BYTES = 32_768;

export async function handleEvaluationRequest(
  request: Request,
  dependencies: {
    repository: EvaluationRepository | null;
    createId: () => string;
    now: () => string;
  },
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ ok: false, error: "cross_origin_request" }, 403);
  }

  const identity = readAuthenticatedIdentity(request.headers);
  if (!identity) {
    return json({ ok: false, error: "authentication_required" }, 401);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_JSON_BYTES) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!dependencies.repository) {
    return json({ ok: false, error: "service_unavailable" }, 503);
  }

  try {
    const result = await submitEvaluation(
      { identity, body, now: dependencies.now() },
      {
        repository: dependencies.repository,
        createId: dependencies.createId,
      },
    );
    return json(result, result.status);
  } catch {
    return json({ ok: false, error: "internal_error" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
