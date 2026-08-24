import assert from "node:assert/strict";
import test from "node:test";

import { evaluationCompletionState, navigationForRole, onboardingForTeam } from "../app/view-model.ts";

test("separates administrator navigation from the worker evaluation area", () => {
  assert.deepEqual(navigationForRole("admin").map((item) => item.id), ["inicio", "equipo", "operacion", "acuerdo", "credenciales", "auditoria"]);
  assert.deepEqual(navigationForRole("worker").map((item) => item.id), ["inicio", "evaluaciones", "acuerdo"]);
});

test("derives onboarding only from stored real workers", () => {
  assert.deepEqual(onboardingForTeam([]), { created: 0, target: 6, ready: false, next: "Crea la primera cuenta del equipo." });
  assert.deepEqual(onboardingForTeam(Array.from({ length: 6 }, (_, index) => ({ id: `u${index}` }))), { created: 6, target: 6, ready: true, next: "Las seis cuentas del equipo están creadas." });
});

test("separates missing daily evaluations from the real monthly score", () => {
  assert.deepEqual(evaluationCompletionState({ completedSubmissions: 7, expectedSubmissions: 10 }), {
    completionPercent: 70,
    pendingSubmissions: 3,
    label: "3 evaluaciones pendientes",
  });
  assert.deepEqual(evaluationCompletionState({ completedSubmissions: 0, expectedSubmissions: 0 }), {
    completionPercent: 0,
    pendingSubmissions: 0,
    label: "Sin turnos evaluables",
  });
});
