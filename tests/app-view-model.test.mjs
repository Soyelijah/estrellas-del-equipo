import assert from "node:assert/strict";
import test from "node:test";

import { navigationForRole, onboardingForTeam } from "../app/view-model.ts";

test("separates administrator navigation from the worker evaluation area", () => {
  assert.deepEqual(navigationForRole("admin").map((item) => item.id), ["inicio", "equipo", "operacion", "acuerdo", "credenciales", "auditoria"]);
  assert.deepEqual(navigationForRole("worker").map((item) => item.id), ["inicio", "evaluaciones", "acuerdo"]);
});

test("derives onboarding only from stored real workers", () => {
  assert.deepEqual(onboardingForTeam([]), { created: 0, target: 6, ready: false, next: "Crea la primera cuenta del equipo." });
  assert.deepEqual(onboardingForTeam(Array.from({ length: 6 }, (_, index) => ({ id: `u${index}` }))), { created: 6, target: 6, ready: true, next: "Las seis cuentas del equipo están creadas." });
});
