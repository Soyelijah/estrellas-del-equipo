/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { D1EvaluationRepository } from "../server/d1-evaluation-repository";
import { handleEvaluationRequest } from "../server/evaluation-http";
import { D1AdminAuthRepository } from "../server/d1-admin-auth-repository";
import { handleAdminAuthRequest } from "../server/admin-auth-http";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "../server/passwords";
import { createRecoveryGrant, createSetupGrant, verifyRecoveryGrant, verifySetupAccessKey, verifySetupGrant } from "../server/setup-access";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  ADMIN_SETUP_ACCESS_KEY_HASH?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/api/evaluations") {
      if (request.method !== "POST") {
        return Response.json(
          { ok: false, error: "method_not_allowed" },
          {
            status: 405,
            headers: { allow: "POST", "cache-control": "no-store" },
          },
        );
      }

      return handleEvaluationRequest(request, {
        repository: env.DB ? new D1EvaluationRepository(env.DB) : null,
        createId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
    }

    if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/admin/")) {
      if (!env.DB) {
        return Response.json(
          { ok: false, error: "service_unavailable" },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
      return handleAdminAuthRequest(request, {
        repository: new D1AdminAuthRepository(env.DB),
        createId: () => crypto.randomUUID(),
        createToken: createSessionToken,
        hashPassword,
        verifyPassword,
        hashToken: hashSessionToken,
        setupAccessConfigured: Boolean(env.ADMIN_SETUP_ACCESS_KEY_HASH),
        verifySetupAccessKey: (accessKey) => verifySetupAccessKey(accessKey, env.ADMIN_SETUP_ACCESS_KEY_HASH ?? ""),
        createSetupGrant: () => createSetupGrant(env.ADMIN_SETUP_ACCESS_KEY_HASH ?? "", new Date().toISOString(), createSessionToken),
        verifySetupGrant: (grant) => verifySetupGrant(grant, env.ADMIN_SETUP_ACCESS_KEY_HASH ?? "", new Date().toISOString()),
        createRecoveryGrant: () => createRecoveryGrant(env.ADMIN_SETUP_ACCESS_KEY_HASH ?? "", new Date().toISOString(), createSessionToken),
        verifyRecoveryGrant: (grant) => verifyRecoveryGrant(grant, env.ADMIN_SETUP_ACCESS_KEY_HASH ?? "", new Date().toISOString()),
        now: () => new Date().toISOString(),
      });
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
