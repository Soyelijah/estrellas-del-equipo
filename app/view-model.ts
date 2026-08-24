export type AppView =
  | "inicio"
  | "equipo"
  | "operacion"
  | "credenciales"
  | "auditoria"
  | "evaluaciones"
  | "acuerdo";

const adminNavigation = [
  { id: "inicio", label: "Inicio", icon: "⌂" },
  { id: "equipo", label: "Equipo", icon: "♙" },
  { id: "operacion", label: "Evaluaciones", icon: "✦" },
  { id: "acuerdo", label: "Propinas", icon: "♢" },
  { id: "credenciales", label: "Credenciales", icon: "◇" },
  { id: "auditoria", label: "Auditoría", icon: "◎" },
] as const;

const workerNavigation = [
  { id: "inicio", label: "Inicio", icon: "⌂" },
  { id: "evaluaciones", label: "Evaluaciones", icon: "☆" },
  { id: "acuerdo", label: "Propinas", icon: "♢" },
] as const;

export function navigationForRole(role: string) {
  return role === "admin" ? adminNavigation : workerNavigation;
}

export function onboardingForTeam(team: Array<{ id: string }>) {
  const created = team.length;
  return {
    created,
    ready: created > 0,
    next:
      created === 0
        ? "Crea la primera cuenta real del equipo."
        : "Puedes seguir agregando todas las cuentas reales que necesite el equipo.",
  };
}

export function evaluationCompletionState(input: {
  completedSubmissions: number;
  expectedSubmissions: number;
}) {
  const completedSubmissions = Math.max(
    0,
    Math.trunc(input.completedSubmissions),
  );
  const expectedSubmissions = Math.max(
    completedSubmissions,
    Math.trunc(input.expectedSubmissions),
  );
  const pendingSubmissions = expectedSubmissions - completedSubmissions;
  return {
    completionPercent:
      expectedSubmissions === 0
        ? 0
        : Math.round((completedSubmissions / expectedSubmissions) * 100),
    pendingSubmissions,
    label:
      expectedSubmissions === 0
        ? "Sin turnos evaluables"
        : pendingSubmissions === 0
          ? "Evaluaciones completas"
          : `${pendingSubmissions} ${pendingSubmissions === 1 ? "evaluación pendiente" : "evaluaciones pendientes"}`,
  };
}
