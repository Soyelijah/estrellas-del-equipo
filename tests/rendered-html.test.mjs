import assert from "node:assert/strict";
import test from "node:test";

test("renders only the access boundary before authentication", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.doesNotMatch(html, /codex-preview/);
  assert.match(html, /Preparando el acceso/);
  assert.doesNotMatch(html, /Configuración confirmada|4,65|Aún no hay evaluaciones registradas/);
  assert.doesNotMatch(
    html,
    /Señal mensual de ejemplo|4\.75|Julio 2026|Recompensa aprobada|Vista de demostración/,
  );
});
