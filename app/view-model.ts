export type AppView = "inicio" | "equipo" | "credenciales" | "auditoria" | "evaluaciones" | "acuerdo";

const adminNavigation = [
  { id: "inicio", label: "Inicio", icon: "⌂" },
  { id: "equipo", label: "Equipo", icon: "♙" },
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
    target: 6,
    ready: created >= 6,
    next: created >= 6 ? "Las seis cuentas del equipo están creadas." : created === 0 ? "Crea la primera cuenta del equipo." : `Faltan ${6 - created} cuentas para completar el equipo acordado.`,
  };
}
