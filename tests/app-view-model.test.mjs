import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluationCompletionState,
  evaluationWorkspaceState,
  navigationForRole,
  onboardingForTeam,
  shiftRemovalReducer,
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

test("keeps the shift confirmation open and explains a failed removal", () => {
  const target = {
    id: "shift-1",
    startsAt: "2026-08-24T15:00:00.000Z",
    endsAt: "2026-08-25T01:00:00.000Z",
    memberCount: 5,
  };

  const confirming = shiftRemovalReducer(
    { status: "idle", target: null, error: null, success: null },
    { type: "choose", target },
  );
  const submitting = shiftRemovalReducer(confirming, { type: "submit" });
  const failed = shiftRemovalReducer(submitting, {
    type: "fail",
    message:
      "Este turno ya tiene evaluaciones. Anula primero esas evaluaciones desde Historial.",
  });

  assert.deepEqual(failed, {
    status: "confirming",
    target,
    error:
      "Este turno ya tiene evaluaciones. Anula primero esas evaluaciones desde Historial.",
    success: null,
  });
});

test("closes the shift confirmation only after a successful removal and announces it", () => {
  const target = {
    id: "shift-2",
    startsAt: "2026-08-24T15:00:00.000Z",
    endsAt: "2026-08-25T01:00:00.000Z",
    memberCount: 3,
  };
  const confirming = shiftRemovalReducer(
    { status: "idle", target: null, error: null, success: null },
    { type: "choose", target },
  );

  assert.deepEqual(
    shiftRemovalReducer(confirming, {
      type: "succeed",
      message: "Turno eliminado correctamente.",
    }),
    {
      status: "idle",
      target: null,
      error: null,
      success: "Turno eliminado correctamente.",
    },
  );
});
