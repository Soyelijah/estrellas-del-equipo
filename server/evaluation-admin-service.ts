import type { SessionActor } from "./admin-auth-service.ts";

type EvaluationAdminRepository = {
  openEvaluationCycle(record: Record<string, unknown>): Promise<{ created: true } | { created: false; reason: string }>;
  createEvaluationShift(record: Record<string, unknown>): Promise<{ created: true } | { created: false; reason: string }>;
};

const DEFAULT_CRITERIA = [
  { code: "menu_knowledge", name: "Conocimiento de la carta", description: "Reconoce comidas, tragos, vinos, ingredientes y recomendaciones.", category: "knowledge", weightBasisPoints: 1800 },
  { code: "product_explanation", name: "Explicación al cliente", description: "Explica cada producto con claridad, seguridad y fluidez.", category: "communication", weightBasisPoints: 1700 },
  { code: "command_accuracy", name: "Precisión al comandar", description: "Registra pedidos completos y evita errores que afecten el servicio.", category: "accuracy", weightBasisPoints: 2000 },
  { code: "teamwork", name: "Trabajo en equipo", description: "Coordina, apoya y se comunica durante momentos de presión.", category: "teamwork", weightBasisPoints: 1800 },
  { code: "service_attitude", name: "Atención y actitud", description: "Mantiene trato profesional, iniciativa y orientación al cliente.", category: "service", weightBasisPoints: 1500 },
  { code: "reliability", name: "Responsabilidad", description: "Cumple acuerdos, mantiene orden y responde por sus tareas.", category: "reliability", weightBasisPoints: 1200 },
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
  if (!section || !startsAt || !endsAt || endsAt <= startsAt || membershipIds.length < 2 || membershipIds.length > 30) {
    return { ok: false as const, status: 422 as const, error: "invalid_evaluation_shift" };
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
    const status = result.reason === "invalid_shift_members" || result.reason === "evaluation_cycle_required" ? 422 : 409;
    return { ok: false as const, status, error: result.reason };
  }
  return { ok: true as const, status: 201 as const };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : null;
}

function isoDate(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
