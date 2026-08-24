import type { SessionActor } from "./admin-auth-service.ts";

type EvaluationAdminRepository = {
  openEvaluationCycle(record: Record<string, unknown>): Promise<{ created: true } | { created: false; reason: string }>;
  createEvaluationShift(record: Record<string, unknown>): Promise<{ created: true } | { created: false; reason: string }>;
  deleteEvaluationShift(record: Record<string, unknown>): Promise<{ deleted: true } | { deleted: false; reason: string }>;
  closeEvaluationCycle(record: Record<string, unknown>): Promise<{ updated: boolean }>;
  deleteEvaluationCycle(record: Record<string, unknown>): Promise<{ deleted: boolean }>;
};

const LEGACY_DELETE_CONFIRMATION = "CONFIRMO ELIMINAR CICLO ANTIGUO";

const DEFAULT_CRITERIA = [
  { code: "discipline", name: "Disciplina, puntualidad y presentación", description: "Llega a tiempo, cumple horarios, mantiene uniforme y presentación adecuados, respeta normas y permanece preparado durante el turno.", category: "discipline", weightBasisPoints: 1667 },
  { code: "operational_responsibility", name: "Responsabilidad y precisión operativa", description: "Toma comandas correctamente, confirma pedidos, evita errores, cumple sus tareas de apertura y cierre, y se hace responsable de lo que le corresponde.", category: "reliability", weightBasisPoints: 1667 },
  { code: "customer_experience", name: "Atención y experiencia del cliente", description: "Recibe con amabilidad, escucha, explica con claridad, anticipa necesidades, maneja reclamos correctamente y mantiene un servicio profesional.", category: "service", weightBasisPoints: 1667 },
  { code: "menu_knowledge", name: "Conocimiento de carta y recomendación", description: "Conoce comidas, ingredientes, alérgenos, tragos y vinos; puede explicarlos con fluidez y recomendar opciones apropiadas sin inventar información.", category: "knowledge", weightBasisPoints: 1667 },
  { code: "teamwork", name: "Comunicación, compañerismo y trabajo en equipo", description: "Informa oportunamente, coordina con salón, barra y caja, ayuda cuando un compañero está sobrecargado y evita conflictos o comentarios perjudiciales.", category: "teamwork", weightBasisPoints: 1666 },
  { code: "continuous_improvement", name: "Autocrítica, aprendizaje y mejora continua", description: "Reconoce errores, acepta correcciones, evita repetirlos, pregunta cuando desconoce algo y demuestra avances reales durante el período evaluado.", category: "improvement", weightBasisPoints: 1666 },
] as const;

export async function openEvaluationCycle(
  input: unknown,
  actor: SessionActor,
  dependencies: { repository: EvaluationAdminRepository; createId: () => string; now: string },
) {
  if (actor.role !== "admin") return { ok: false as const, status: 403 as const, error: "admin_required" };
  if (!isRecord(input)) return { ok: false as const, status: 422 as const, error: "invalid_evaluation_cycle" };
  const name = boundedText(input.name, 2, 80);
  const startsAt = isoDate(input.startsAt);
  const endsAt = isoDate(input.endsAt);
  if (!name || !startsAt || !endsAt || endsAt <= startsAt) {
    return { ok: false as const, status: 422 as const, error: "invalid_evaluation_cycle" };
  }

  const result = await dependencies.repository.openEvaluationCycle({
    organizationId: actor.organizationId,
    createdByMembershipId: actor.membershipId,
    policyId: dependencies.createId(),
    periodId: dependencies.createId(),
    auditId: dependencies.createId(),
    name,
    startsAt,
    endsAt,
    now: dependencies.now,
    criteria: DEFAULT_CRITERIA.map((criterion) => ({ ...criterion, id: dependencies.createId() })),
  });
  if (!result.created) {
    const status = result.reason === "insufficient_workers" ? 422 : 409;
    return { ok: false as const, status, error: result.reason };
  }
  return { ok: true as const, status: 201 as const };
}

export async function deleteEvaluationShift(
  input: unknown,
  actor: SessionActor,
  dependencies: {
    repository: EvaluationAdminRepository;
    createId: () => string;
    now: string;
    shiftId: string;
  },
) {
  if (actor.role !== "admin") return { ok: false as const, status: 403 as const, error: "admin_required" };
  const shiftId = uuidText(dependencies.shiftId) ? dependencies.shiftId : null;
  const reason = isRecord(input) ? boundedText(input.reason, 8, 240) : null;
  if (!shiftId || !reason) return { ok: false as const, status: 422 as const, error: "invalid_shift_delete" };
  const result = await dependencies.repository.deleteEvaluationShift({
    shiftId,
    organizationId: actor.organizationId,
    actorMembershipId: actor.membershipId,
    auditId: dependencies.createId(),
    reason,
    now: dependencies.now,
  });
  if (!result.deleted) {
    return result.reason === "shift_has_evaluations"
      ? { ok: false as const, status: 409 as const, error: result.reason }
      : { ok: false as const, status: 404 as const, error: result.reason };
  }
  return { ok: true as const, status: 200 as const };
}

export async function registerEvaluationShift(
  input: unknown,
  actor: SessionActor,
  dependencies: { repository: EvaluationAdminRepository; createId: () => string; now: string },
) {
  if (actor.role !== "admin") return { ok: false as const, status: 403 as const, error: "admin_required" };
  if (!isRecord(input)) return { ok: false as const, status: 422 as const, error: "invalid_evaluation_shift" };
  const section = boundedText(input.section, 2, 80);
  const startsAt = isoDate(input.startsAt);
  const endsAt = isoDate(input.endsAt);
  const membershipIds = Array.isArray(input.membershipIds)
    ? [...new Set(input.membershipIds.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 128))]
    : [];
  const durationMilliseconds =
    startsAt && endsAt
      ? new Date(endsAt).getTime() - new Date(startsAt).getTime()
      : 0;
  if (!section || !startsAt || !endsAt || endsAt <= startsAt || membershipIds.length < 2 || membershipIds.length > 30) {
    return { ok: false as const, status: 422 as const, error: "invalid_evaluation_shift" };
  }
  if (durationMilliseconds > 18 * 60 * 60 * 1000) {
    return { ok: false as const, status: 422 as const, error: "invalid_shift_duration" };
  }

  const result = await dependencies.repository.createEvaluationShift({
    id: dependencies.createId(),
    auditId: dependencies.createId(),
    organizationId: actor.organizationId,
    createdByMembershipId: actor.membershipId,
    section,
    startsAt,
    endsAt,
    membershipIds,
    now: dependencies.now,
  });
  if (!result.created) {
    const status = [
      "invalid_shift_members",
      "evaluation_cycle_required",
      "shift_outside_cycle",
    ].includes(result.reason)
      ? 422
      : 409;
    return { ok: false as const, status, error: result.reason };
  }
  return { ok: true as const, status: 201 as const };
}

export async function closeEvaluationCycle(
  input: unknown,
  actor: SessionActor,
  dependencies: { repository: EvaluationAdminRepository; createId: () => string; now: string; periodId: string },
) {
  if (actor.role !== "admin") return { ok: false as const, status: 403 as const, error: "admin_required" };
  const periodId = boundedText(dependencies.periodId, 1, 128);
  const reason = isRecord(input) ? boundedText(input.reason, 4, 240) : null;
  if (!periodId || !reason) return { ok: false as const, status: 422 as const, error: "invalid_cycle_close" };
  const result = await dependencies.repository.closeEvaluationCycle({
    periodId,
    organizationId: actor.organizationId,
    actorMembershipId: actor.membershipId,
    auditId: dependencies.createId(),
    reason,
    now: dependencies.now,
  });
  return result.updated
    ? { ok: true as const, status: 200 as const }
    : { ok: false as const, status: 404 as const, error: "evaluation_cycle_not_found" };
}

export async function deleteEvaluationCyclePermanently(
  input: unknown,
  actor: SessionActor,
  dependencies: { repository: EvaluationAdminRepository; createId: () => string; now: string; periodId: string },
) {
  if (actor.role !== "admin") return { ok: false as const, status: 403 as const, error: "admin_required" };
  if (!isRecord(input)) return { ok: false as const, status: 422 as const, error: "invalid_cycle_delete" };
  const confirmation = typeof input.confirmation === "string" ? input.confirmation.trim() : "";
  const reason = boundedText(input.reason, 8, 240);
  if (!uuidText(dependencies.periodId) || confirmation !== LEGACY_DELETE_CONFIRMATION || !reason) {
    return { ok: false as const, status: 422 as const, error: "invalid_cycle_delete" };
  }
  const result = await dependencies.repository.deleteEvaluationCycle({
    periodId: dependencies.periodId,
    organizationId: actor.organizationId,
    actorMembershipId: actor.membershipId,
    auditId: dependencies.createId(),
    reason,
    now: dependencies.now,
  });
  if (!result.deleted) return { ok: false as const, status: 404 as const, error: "evaluation_cycle_not_found" };
  return { ok: true as const, status: 200 as const };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : null;
}

function uuidText(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isoDate(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
