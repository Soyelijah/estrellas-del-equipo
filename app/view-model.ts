export type AppView =
  | "inicio"
  | "equipo"
  | "operacion"
  | "credenciales"
  | "auditoria"
  | "evaluaciones"
  | "acuerdo";

export type EvaluationAdminSection =
  | "cycle"
  | "shifts"
  | "history"
  | "close"
  | "control";

export function evaluationAdminSections(input: {
  shiftCount: number;
  submissionCount: number;
}) {
  const shiftLabel = input.shiftCount === 1 ? "turno registrado" : "turnos registrados";
  const submissionLabel = input.submissionCount === 1 ? "evaluación" : "evaluaciones";

  return [
    {
      id: "cycle",
      index: "01",
      label: "Ciclo y resultados",
      detail: "Mes vigente, criterios y resultados",
    },
    {
      id: "shifts",
      index: "02",
      label: "Turnos diarios",
      detail: `${input.shiftCount} ${shiftLabel}`,
    },
    {
      id: "history",
      index: "03",
      label: "Historial",
      detail: `${input.submissionCount} ${submissionLabel}`,
    },
    {
      id: "close",
      index: "04",
      label: "Cierre del mes",
      detail: "Finalizar y bloquear evaluaciones",
    },
    {
      id: "control",
      index: "05",
      label: "Zona de control",
      detail: "Acciones irreversibles del ciclo",
    },
  ] satisfies Array<{
    id: EvaluationAdminSection;
    index: string;
    label: string;
    detail: string;
  }>;
}

export type ShiftRemovalTarget = {
  id: string;
  startsAt: string;
  endsAt: string;
  memberCount: number;
};

export type ShiftRemovalState = {
  status: "idle" | "confirming" | "submitting";
  target: ShiftRemovalTarget | null;
  error: string | null;
  success: string | null;
};

export type ShiftRemovalAction =
  | { type: "choose"; target: ShiftRemovalTarget }
  | { type: "submit" }
  | { type: "fail"; message: string }
  | { type: "succeed"; message: string }
  | { type: "cancel" }
  | { type: "dismiss-success" };

export function shiftRemovalReducer(
  state: ShiftRemovalState,
  action: ShiftRemovalAction,
): ShiftRemovalState {
  switch (action.type) {
    case "choose":
      return {
        status: "confirming",
        target: action.target,
        error: null,
        success: null,
      };
    case "submit":
      return state.target
        ? { ...state, status: "submitting", error: null }
        : state;
    case "fail":
      return state.target
        ? { ...state, status: "confirming", error: action.message }
        : state;
    case "succeed":
      return {
        status: "idle",
        target: null,
        error: null,
        success: action.message,
      };
    case "cancel":
      return { status: "idle", target: null, error: null, success: null };
    case "dismiss-success":
      return { ...state, success: null };
  }
}

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

export function evaluationWorkspaceState(input: {
  loading: boolean;
  unavailable: boolean;
  hasWorkspace: boolean;
}) {
  if (input.loading && !input.hasWorkspace) return "loading" as const;
  if (input.unavailable && !input.hasWorkspace) return "unavailable" as const;
  return input.hasWorkspace ? "ready" as const : "empty" as const;
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
