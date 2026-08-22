import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginMutation } from "../server/request-security.ts";

test("accepts a mutation from the exact application origin", () => {
  const request = new Request("https://equipo.example/api/evaluations", {
    method: "POST",
    headers: {
      origin: "https://equipo.example",
      "sec-fetch-site": "same-origin",
    },
  });

  assert.equal(isSameOriginMutation(request), true);
});

test("rejects cross-site, missing-origin, and lookalike origins", () => {
  const requests = [
    new Request("https://equipo.example/api/evaluations", {
      method: "POST",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    }),
    new Request("https://equipo.example/api/evaluations", { method: "POST" }),
    new Request("https://equipo.example/api/evaluations", {
      method: "POST",
      headers: { origin: "https://equipo.example.evil.test" },
    }),
  ];

  for (const request of requests) {
    assert.equal(isSameOriginMutation(request), false);
  }
});
