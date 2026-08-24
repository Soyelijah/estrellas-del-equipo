import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluationCompletionState,
  evaluationWorkspaceState,
  navigationForRole,
  onboardingForTeam,
} from "../app/view-model.ts";

test("does not confuse a failed workspace read with an empty evaluation cycle", () => {
  assert.equal(evaluationWorkspaceState({ loading: true, unavailable: false, hasWorkspace: false }), "loading");
  assert.equal(evaluationWorkspaceState({ loading: false, unavailable: true, hasWorkspace: false }), "unavailable");
  assert.equal(evaluationWorkspaceState({ loading: false, unavailable: false, hasWorkspace: false }), "empty");
  assert.equal(evaluationWorkspaceState({ loading: false, unavailable: false, hasWorkspace: true }), "ready");
});

test("separates administrator navigation from the worker evaluation area", () => {
  assert.deepEqual(
    navigationForRole("admin").map((item) => item.id),
    ["inicio", "equipo", "operacion", "acuerdo", "credenciales", "auditoria"],
  );
  assert.deepEqual(
    navigationForRole("worker").map((item) => item.id),
    ["inicio", "evaluaciones", "acuerdo"],
  );
});

test("derives onboarding only from stored real workers", () => {
  assert.deepEqual(onboardingForTeam([]), {
    created: 0,
    ready: false,
    next: "Crea la primera cuenta real del equipo.",
  });
  assert.deepEqual(
    onboardingForTeam(
      Array.from({ length: 8 }, (_, index) => ({ id: `u${index}` })),
    ),
    {
      created: 8,
      ready: true,
      next: "Puedes seguir agregando todas las cuentas reales que necesite el equipo.",
    },
  );
});

test("separates missing daily evaluations from the real monthly score", () => {
  assert.deepEqual(
    evaluationCompletionState({
      completedSubmissions: 7,
      expectedSubmissions: 10,
    }),
    {
      completionPercent: 70,
      pendingSubmissions: 3,
      label: "3 evaluaciones pendientes",
    },
  );
  assert.deepEqual(
    evaluationCompletionState({
      completedSubmissions: 0,
      expectedSubmissions: 0,
    }),
    {
      completionPercent: 0,
      pendingSubmissions: 0,
      label: "Sin turnos evaluables",
    },
  );
});
