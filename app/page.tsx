"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";
import {
  allocateTipPoolByExperienceFactors,
  formatExperienceFactor,
} from "../domain/tips";
import {
  AppView,
  evaluationAdminSections,
  evaluationCompletionState,
  evaluationWorkspaceState,
  navigationForRole,
  onboardingForTeam,
  shiftRemovalReducer,
  type EvaluationAdminSection,
  type ShiftRemovalState,
} from "./view-model";
import { retryRead } from "./resilient-read";

const LOGIN_SLOW_NOTICE_MS = 4_000;
const LOGIN_TIMEOUT_MS = 45_000;
const AUTH_STATUS_TIMEOUT_MS = 5_000;
const READ_RETRY_DELAYS_MS = [250, 750] as const;
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function subscribeFinePointer(callback: () => void) {
  const media = window.matchMedia(FINE_POINTER_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function hasFinePointer() {
  return window.matchMedia(FINE_POINTER_QUERY).matches;
}

async function readJsonWithRetry<T>(path: string): Promise<T> {
  return retryRead(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      AUTH_STATUS_TIMEOUT_MS,
    );
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`read_failed_${response.status}`);
      return (await response.json()) as T;
    } finally {
      window.clearTimeout(timeout);
    }
  }, READ_RETRY_DELAYS_MS);
}

const jobTitles = {
  head_waiter: "Jefe de garzones",
  waiter: "Garzón",
  bartender: "Barman",
  cashier: "Cajera",
} as const;
type JobTitle = keyof typeof jobTitles;
type Account = { userId: string; displayName: string; role: string };
type TeamMember = {
  id: string;
  displayName: string;
  status: string;
  role: string;
  jobTitle: JobTitle;
  tipFactorHundredths: number;
  email: string | null;
  phone: string | null;
  bio: string | null;
  hiredOn: string | null;
  hasAvatar: boolean;
};
type StoredUser = TeamMember & { loginIdentifier: string };
type AuditEvent = {
  id: string;
  action: string;
  objectType: string;
  objectId: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorDisplayName: string | null;
};
type EvaluationSummary = {
  periodId: string;
  completedSubmissions: number;
  expectedSubmissions: number;
  completionPercent: number;
  daily: Array<{
    serviceDate: string;
    completedSubmissions: number;
    expectedSubmissions: number;
  }>;
  results: Array<{
    membershipId: string;
    displayName: string;
    jobTitle: JobTitle;
    score: number | null;
    actualScore: number | null;
    estimatedDays: number;
    unscoredDays: number;
    evaluatedDays: number;
    independentRaters: number;
    completedSubmissions: number;
    criteria: Array<{
      criterionId: string;
      name: string;
      score: number | null;
    }>;
  }>;
};
type EvaluationOperations = {
  period: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
    status: string;
    submissionCount: number;
  } | null;
  criteria: Array<{
    id: string;
    name: string;
    description: string;
    weightBasisPoints: number;
  }>;
  members: Array<{
    membershipId: string;
    displayName: string;
    jobTitle: JobTitle;
    status: string;
    canEvaluate: boolean;
    canBeEvaluated: boolean;
  }>;
  shifts: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    section: string;
    status: string;
    memberCount: number;
  }>;
  submissions: Array<{
    id: string;
    status: "submitted" | "reopened" | "voided";
    submittedAt: string;
    periodName: string;
    shiftStartsAt: string;
    raterMembershipId: string;
    raterDisplayName: string;
    subjectMembershipId: string;
    subjectDisplayName: string;
    score: number | null;
    responseCount: number;
  }>;
  summary: EvaluationSummary | null;
};
type EvaluationWorkspace = {
  period: { id: string; name: string; endsAt: string } | null;
  criteria: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
  }>;
  assignments: Array<{
    shiftId: string;
    startsAt: string;
    endsAt: string;
    section: string;
    subjectMembershipId: string;
    subjectDisplayName: string;
    subjectJobTitle: JobTitle;
  }>;
};
type ShiftConfirmation = {
  startsAt: string;
  endsAt: string;
  participantNames: string[];
};
type AuthState = {
  loading: boolean;
  bootstrapAllowed: boolean;
  setupUnlocked: boolean;
  recoveryUnlocked: boolean;
  account: Account | null;
  users: StoredUser[];
  team: TeamMember[];
  unavailable: boolean;
};
type AccessMode =
  | "login"
  | "setup-key"
  | "setup-account"
  | "recovery-key"
  | "recovery-password";

const initialAuth: AuthState = {
  loading: true,
  bootstrapAllowed: false,
  setupUnlocked: false,
  recoveryUnlocked: false,
  account: null,
  users: [],
  team: [],
  unavailable: false,
};
const clpFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const auditLabels: Record<string, string> = {
  "user.created": "Cuenta creada",
  "user.updated": "Datos actualizados",
  "user.suspended": "Cuenta suspendida",
  "user.reactivated": "Cuenta reactivada",
  "user.deleted": "Cuenta eliminada",
  "user.password_reset": "Contraseña restablecida",
  "admin.password_recovered": "Acceso administrador recuperado",
  "evaluation.cycle_opened": "Ciclo de evaluación abierto",
  "evaluation.cycle_closed": "Mes de evaluación cerrado",
  "evaluation.submission_voided": "Evaluación anulada",
  "evaluation.submission_restored": "Evaluación restaurada",
  "evaluation.history_voided": "Historial de evaluaciones anulado",
  "evaluation.cycle_deleted": "Ciclo de evaluación eliminado",
  "evaluation.shift_recorded": "Turno compartido registrado",
  "evaluation.shift_deleted": "Turno eliminado",
};
function initials(label: string) {
  return label
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function statusLabel(status: string) {
  return status === "active"
    ? "Activa"
    : status === "disabled"
      ? "Suspendida"
      : status;
}

async function prepareAvatar(file: File) {
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) throw new Error("invalid_avatar");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const size = Math.min(320, image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("invalid_avatar");
    const crop = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.size > 160 * 1024) throw new Error("invalid_avatar");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("invalid_avatar"));
      reader.readAsDataURL(blob);
    });
    return { mimeType: "image/webp", base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ProfileAvatar({ member, className = "small" }: { member: Pick<TeamMember, "id" | "displayName" | "hasAvatar">; className?: string }) {
  return member.hasAvatar
    ? <img /* eslint-disable-line @next/next/no-img-element -- authenticated same-origin image endpoint */ className={`avatar ${className} profile-photo`} src={`/api/users/${member.id}/avatar`} alt={`Foto de ${member.displayName}`} />
    : <span className={`avatar ${className}`} aria-hidden="true">{initials(member.displayName)}</span>;
}

export default function Home() {
  const [auth, setAuth] = useState<AuthState>(initialAuth);
  const [view, setView] = useState<AppView>("inicio");
  const [accessMode, setAccessMode] = useState<AccessMode>("login");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [tipPoolPesos, setTipPoolPesos] = useState(0);
  const [operations, setOperations] = useState<EvaluationOperations | null>(
    null,
  );
  const [workspace, setWorkspace] = useState<EvaluationWorkspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [shiftConfirmation, setShiftConfirmation] =
    useState<ShiftConfirmation | null>(null);
  const [shiftRemoval, dispatchShiftRemoval] = useReducer(
    shiftRemovalReducer,
    {
      status: "idle",
      target: null,
      error: null,
      success: null,
    },
  );

  function applyAuth(data: Omit<AuthState, "loading" | "unavailable">) {
    setAuth({ ...data, loading: false, unavailable: false });
    if (!data.account) {
      if (data.bootstrapAllowed)
        setAccessMode(data.setupUnlocked ? "setup-account" : "setup-key");
      else if (data.recoveryUnlocked) setAccessMode("recovery-password");
      else
        setAccessMode((current) =>
          current === "recovery-key" ? current : "login",
        );
    }
  }
  async function fetchAuthState() {
    return readJsonWithRetry<Omit<AuthState, "loading" | "unavailable">>(
      "/api/auth/status",
    );
  }
  async function refreshAuth() {
    setAuth((current) => ({
      ...current,
      loading: !current.account,
      unavailable: false,
    }));
    try {
      applyAuth(await fetchAuthState());
    } catch {
      setAuth((current) => ({ ...current, loading: false, unavailable: true }));
    }
  }
  useEffect(() => {
    let active = true;
    fetchAuthState()
      .then((data) => {
        if (active) applyAuth(data);
      })
      .catch(() => {
        if (active)
          setAuth((current) => ({
            ...current,
            loading: false,
            unavailable: true,
          }));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventContextMenu);
    return () => document.removeEventListener("contextmenu", preventContextMenu);
  }, []);
  useEffect(() => {
    if (!mobileMoreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMoreOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMoreOpen]);

  async function requestJson(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown>,
    timeoutMs?: number,
  ) {
    const controller = new AbortController();
    const timeout = timeoutMs
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return {
        response,
        result: (await response.json()) as { ok: boolean; error?: string; count?: number },
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("request_timeout");
      throw error;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  }
  function friendlyError(error?: string) {
    const errors: Record<string, string> = {
      invalid_account_data:
        "Revisa los datos y usa una contraseña de al menos 12 caracteres.",
      invalid_credentials: "Usuario o contraseña incorrectos.",
      login_identifier_exists: "Ese nombre de usuario ya está ocupado.",
      invalid_profile: "Revisa el correo, teléfono, biografía y fecha de ingreso.",
      invalid_avatar: "La foto no es válida o supera el tamaño permitido.",
      invalid_reset_confirmation: "Escribe exactamente la frase de reinicio solicitada.",
      invalid_history_purge_confirmation: "Escribe exactamente BORRAR HISTORIAL OPERATIVO.",
      history_purge_failed: "No se pudo limpiar el historial operativo.",
      invalid_reset_access_key: "La clave única de configuración inicial no es correcta.",
      invalid_reset_password: "La contraseña actual del administrador no es correcta.",
      invalid_reset_authorization: "No fue posible autorizar el reinicio con esas credenciales.",
      bootstrap_closed: "La cuenta administradora ya está configurada.",
      invalid_access_key: "La clave única no es válida.",
      setup_access_required: "Valida primero la clave única.",
      setup_access_unavailable:
        "La clave única no está configurada en el servidor.",
      recovery_access_required:
        "La autorización venció. Valida nuevamente la clave única.",
      invalid_recovery: "No fue posible recuperar esa cuenta.",
      invalid_recovery_data: "Revisa el usuario y la nueva contraseña.",
      managed_user_not_found: "La cuenta ya no está disponible.",
      invalid_delete_confirmation: "Escribe exactamente el usuario de la cuenta para confirmar su eliminación.",
      admin_required: "Esta acción requiere una cuenta administradora.",
      worker_required: "Esta sección está reservada para trabajadores.",
      invalid_evaluation_cycle: "Revisa el nombre y las fechas del ciclo.",
      open_cycle_exists: "Ya existe un ciclo abierto.",
      insufficient_workers: "Necesitas al menos dos trabajadores activos.",
      invalid_evaluation_shift:
        "Selecciona al menos dos personas y revisa las horas.",
      invalid_shift_duration:
        "Un turno diario debe durar más de 0 y como máximo 18 horas.",
      shift_outside_cycle:
        "La fecha del turno debe estar dentro del ciclo mensual vigente.",
      invalid_shift_delete: "Escribe un motivo claro para eliminar el turno.",
      shift_has_evaluations:
        "Este turno ya tiene evaluaciones. Anula primero esas evaluaciones desde Historial y luego vuelve a intentarlo.",
      evaluation_shift_not_found: "El turno ya no está disponible.",
      evaluation_cycle_required: "Primero abre un ciclo de evaluación.",
      invalid_shift_members:
        "El turno contiene una cuenta inactiva o no autorizada.",
      invalid_cycle_close: "Escribe un motivo claro antes de cerrar el mes.",
      invalid_cycle_delete:
        "Escribe la confirmación exacta y un motivo claro para eliminar el ciclo.",
      evaluation_cycle_not_found:
        "El mes ya estaba cerrado o no está disponible.",
      invalid_evaluation_moderation:
        "Escribe un motivo claro antes de cambiar esta evaluación.",
      evaluation_submission_not_found:
        "La evaluación ya no está disponible.",
      subject_not_evaluable:
        "No puede restaurarse porque esa persona no es evaluable según el acuerdo vigente.",
      invalid_history_delete:
        "Selecciona la persona, el alcance, escribe ANULAR HISTORIAL y agrega un motivo.",
      evaluation_member_not_found:
        "La persona seleccionada ya no está disponible.",
      insufficient_observation:
        "Debes valorar al menos dos aspectos que sí observaste.",
      missing_observation_note:
        "Explica brevemente por qué no pudiste observar esa conducta.",
      invalid_observation_note:
        "La explicación debe tener entre 8 y 240 caracteres.",
      duplicate_submission: "Esta evaluación ya fue enviada.",
      missing_criterion_response:
        "Responde todos los aspectos antes de guardar.",
      no_shared_shift:
        "Solo puedes evaluar a personas con quienes compartiste este turno.",
    };
    return errors[error ?? ""] ?? "No fue posible completar la acción.";
  }
  async function submitAccess(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const isLogin = path.endsWith("/login");
    const slowNotice = isLogin
      ? window.setTimeout(
          () =>
            setMessage(
              "El servidor está tardando más de lo habitual. Seguimos verificando tu acceso…",
            ),
          LOGIN_SLOW_NOTICE_MS,
        )
      : null;
    try {
      const { response, result } = await requestJson(
        path,
        "POST",
        Object.fromEntries(new FormData(form)),
        isLogin ? LOGIN_TIMEOUT_MS : undefined,
      );
      if (slowNotice !== null) window.clearTimeout(slowNotice);
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      form.reset();
      if (path.endsWith("/unlock"))
        setMessage("Clave validada. La autorización dura 10 minutos.");
      else if (path.endsWith("/bootstrap"))
        setMessage("Cuenta creada. Inicia sesión con tus credenciales.");
      else if (path.endsWith("/complete")) {
        setAccessMode("login");
        setMessage(
          "Contraseña actualizada. Las sesiones anteriores fueron cerradas.",
        );
      } else setMessage("Sesión iniciada.");
      await refreshAuth();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "request_timeout"
          ? "El acceso tardó demasiado. Intenta nuevamente; tus datos siguen seguros."
          : "No se pudo conectar con el sistema.",
      );
    } finally {
      if (slowNotice !== null) window.clearTimeout(slowNotice);
      setSubmitting(false);
    }
  }
  async function submitAdmin(
    event: FormEvent<HTMLFormElement>,
    path: string,
    method: "POST" | "PATCH" = "POST",
  ) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    try {
      const formData = Object.fromEntries(new FormData(form));
      const { response, result } = await requestJson(
        path,
        method,
        formData,
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      form.reset();
      setSelectedUserId(null);
      setMessage("Cambio guardado y registrado en la auditoría.");
      await refreshAuth();
    } catch {
      setMessage("No se pudo conectar con el sistema.");
    } finally {
      setSubmitting(false);
    }
  }
  async function changeStatus(user: StoredUser) {
    setSubmitting(true);
    setMessage("");
    try {
      const status = user.status === "active" ? "suspended" : "active";
      const { response, result } = await requestJson(
        `/api/admin/users/${user.id}/status`,
        "POST",
        { status },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      setMessage(
        status === "active"
          ? "Cuenta reactivada."
          : "Cuenta suspendida y sus sesiones cerradas.",
      );
      await refreshAuth();
    } catch {
      setMessage("No se pudo conectar con el sistema.");
    } finally {
      setSubmitting(false);
    }
  }
  async function deleteUser(user: StoredUser, confirmation: string) {
    setSubmitting(true);
    setMessage("");
    try {
      const { response, result } = await requestJson(
        `/api/admin/users/${user.id}`,
        "DELETE",
        { confirmation },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return false;
      }
      setSelectedUserId(null);
      setMessage(`La cuenta de ${user.displayName} fue eliminada. Su historial permanece protegido.`);
      await refreshAuth();
      return true;
    } catch {
      setMessage("No se pudo eliminar la cuenta.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }
  async function updateOwnAvatar(file: File | null) {
    setSubmitting(true);
    setMessage("");
    try {
      const payload = file ? await prepareAvatar(file) : {};
      const { response, result } = await requestJson("/api/account/avatar", file ? "POST" : "DELETE", payload);
      if (!response.ok) return setMessage(friendlyError(result.error));
      setMessage(file ? "Tu foto de perfil fue actualizada." : "Tu foto de perfil fue eliminada.");
      await refreshAuth();
    } catch {
      setMessage("Usa una imagen JPEG, PNG o WebP de hasta 8 MB.");
    } finally {
      setSubmitting(false);
    }
  }
  async function updateOwnProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const { response, result } = await requestJson("/api/account/profile", "PATCH", Object.fromEntries(new FormData(event.currentTarget)));
      if (!response.ok) return setMessage(friendlyError(result.error));
      setMessage("Tu perfil profesional quedó actualizado.");
      await refreshAuth();
    } catch {
      setMessage("No se pudo guardar tu perfil.");
    } finally {
      setSubmitting(false);
    }
  }
  async function purgeHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const form = event.currentTarget;
      const { response, result } = await requestJson("/api/admin/system/purge-history", "POST", Object.fromEntries(new FormData(form)));
      if (!response.ok) return setMessage(friendlyError(result.error));
      form.reset();
      setAuditEvents([]);
      setOperations(null);
      setWorkspace(null);
      setShiftConfirmation(null);
      await refreshAuth();
      setMessage("Historial operativo eliminado. Las cuentas, perfiles, credenciales y porcentajes permanecen intactos.");
    } catch {
      setMessage("No se pudo completar la limpieza protegida.");
    } finally {
      setSubmitting(false);
    }
  }
  async function loadAudit() {
    setAuditLoading(true);
    try {
      const data = await readJsonWithRetry<{ events?: AuditEvent[] }>(
        "/api/admin/audit?limit=50",
      );
      setAuditEvents(data.events ?? []);
    } catch {
      setMessage("No fue posible actualizar la auditoría. Volveremos a intentarlo cuando la abras nuevamente.");
    } finally {
      setAuditLoading(false);
    }
  }
  async function loadOperations() {
    setWorkspaceLoading(true);
    try {
      const data = await readJsonWithRetry<{
        operations?: EvaluationOperations;
      }>("/api/admin/evaluation-operations");
      setOperations(data.operations ?? null);
    } catch {
      setMessage("No fue posible actualizar las evaluaciones. Intenta abrir nuevamente esta sección.");
    } finally {
      setWorkspaceLoading(false);
    }
  }
  async function loadEvaluationWorkspace() {
    setWorkspaceLoading(true);
    setWorkspaceUnavailable(false);
    try {
      const data = await readJsonWithRetry<{
        workspace?: EvaluationWorkspace;
      }>("/api/evaluations");
      setWorkspace(data.workspace ?? null);
    } catch {
      setWorkspaceUnavailable(true);
    } finally {
      setWorkspaceLoading(false);
    }
  }
  async function submitCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const startsAt = new Date(
        `${data.get("startsOn")}T00:00:00`,
      ).toISOString();
      const endsAt = new Date(`${data.get("endsOn")}T23:59:59`).toISOString();
      const { response, result } = await requestJson(
        "/api/admin/evaluation-cycles",
        "POST",
        { name: data.get("name"), startsAt, endsAt },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      form.reset();
      setMessage(
        "Ciclo abierto. Ahora registra los turnos que realmente trabajaron juntos.",
      );
      await loadOperations();
    } catch {
      setMessage("Revisa las fechas del ciclo.");
    } finally {
      setSubmitting(false);
    }
  }
  async function submitCycleClose(
    event: FormEvent<HTMLFormElement>,
    periodId: string,
  ) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { response, result } = await requestJson(
        `/api/admin/evaluation-cycles/${periodId}/close`,
        "POST",
        { reason: data.get("reason") },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      form.reset();
      setMessage(
        "Mes cerrado. Las notas quedaron bloqueadas para tu revisión y decisión final.",
      );
      await loadOperations();
    } catch {
      setMessage("No se pudo cerrar el mes.");
    } finally {
      setSubmitting(false);
    }
  }
  async function submitCycleDelete(
    event: FormEvent<HTMLFormElement>,
    periodId: string,
  ) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { response, result } = await requestJson(
        `/api/admin/evaluation-cycles/${periodId}`,
        "DELETE",
        {
          confirmation: data.get("confirmation"),
          reason: data.get("reason"),
        },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      form.reset();
      setMessage(
        "Ciclo antiguo eliminado. Las cuentas, credenciales y porcentajes permanecen intactos.",
      );
      await loadOperations();
    } catch {
      setMessage("No se pudo eliminar el ciclo antiguo.");
    } finally {
      setSubmitting(false);
    }
  }
  async function submitShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setShiftConfirmation(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const serviceDate = String(data.get("serviceDate") ?? "");
      const startTime = String(data.get("startTime") ?? "");
      const endTime = String(data.get("endTime") ?? "");
      const start = new Date(`${serviceDate}T${startTime}:00`);
      const end = new Date(`${serviceDate}T${endTime}:00`);
      if (end <= start) end.setDate(end.getDate() + 1);
      const startsAt = start.toISOString();
      const endsAt = end.toISOString();
      const { response, result } = await requestJson(
        "/api/admin/evaluation-shifts",
        "POST",
        {
          section: "Turno general",
          startsAt,
          endsAt,
          membershipIds: data.getAll("membershipIds"),
        },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      form.reset();
      setMessage(
        "Turno registrado. Los compañeros ya pueden evaluarse desde sus cuentas.",
      );
      const selectedMembershipIds = new Set(
        data.getAll("membershipIds").map(String),
      );
      setShiftConfirmation({
        startsAt,
        endsAt,
        participantNames:
          operations?.members
            .filter((member) =>
              selectedMembershipIds.has(member.membershipId),
            )
            .map((member) => member.displayName) ?? [],
      });
      await loadOperations();
    } catch {
      setMessage(
        "Revisa las horas del turno y selecciona al menos dos personas.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function submitShiftDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shiftRemoval.target) return;
    dispatchShiftRemoval({ type: "submit" });
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { response, result } = await requestJson(
        `/api/admin/evaluation-shifts/${shiftRemoval.target.id}`,
        "DELETE",
        { reason: data.get("reason") },
      );
      if (!response.ok) {
        dispatchShiftRemoval({
          type: "fail",
          message: friendlyError(result.error),
        });
        return;
      }
      dispatchShiftRemoval({
        type: "succeed",
        message: `Turno del ${formatServiceDate(shiftRemoval.target.startsAt)} eliminado correctamente.`,
      });
      await loadOperations();
    } catch {
      dispatchShiftRemoval({
        type: "fail",
        message:
          "No pudimos eliminar el turno por un problema de conexión. Inténtalo nuevamente; el registro no fue modificado.",
      });
    }
  }
  async function submitEvaluationModeration(
    event: FormEvent<HTMLFormElement>,
    submissionId: string,
    action: "void" | "restore",
  ) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const { response, result } = await requestJson(
        `/api/admin/evaluation-submissions/${submissionId}/status`,
        "PATCH",
        { action, reason: data.get("reason") },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      setMessage(action === "void" ? "Evaluación anulada y retirada de todos los resultados." : "Evaluación restaurada con trazabilidad administrativa.");
      await Promise.all([loadOperations(), loadAudit()]);
    } catch {
      setMessage("No se pudo actualizar la evaluación.");
    } finally {
      setSubmitting(false);
    }
  }
  async function submitHistoryDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const membershipId = String(data.get("membershipId") ?? "");
    try {
      const { response, result } = await requestJson(
        `/api/admin/evaluation-history/${membershipId}`,
        "DELETE",
        { scope: data.get("scope"), reason: data.get("reason"), confirmation: data.get("confirmation") },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      const count = typeof result.count === "number" ? result.count : 0;
      setMessage(`${count} evaluación${count === 1 ? "" : "es"} anulada${count === 1 ? "" : "s"}. La acción quedó registrada.`);
      form.reset();
      await Promise.all([loadOperations(), loadAudit()]);
    } catch {
      setMessage("No se pudo anular el historial seleccionado.");
    } finally {
      setSubmitting(false);
    }
  }
  async function submitEvaluation(
    event: FormEvent<HTMLFormElement>,
    assignment: EvaluationWorkspace["assignments"][number],
  ) {
    event.preventDefault();
    if (!workspace?.period) return;
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const ratings = workspace.criteria.map((criterion) => {
      const value = String(data.get(criterion.id) ?? "");
      return value === "not_observed"
        ? {
            criterionId: criterion.id,
            responseStatus: "not_observed",
            value: null,
            evidenceNote: String(
              data.get(`${criterion.id}:note`) ?? "",
            ).trim(),
          }
        : {
            criterionId: criterion.id,
            responseStatus: "rated",
            value: Number(value),
            evidenceNote: null,
          };
    });
    try {
      const { response, result } = await requestJson(
        "/api/evaluations",
        "POST",
        {
          periodId: workspace.period.id,
          shiftId: assignment.shiftId,
          subjectMembershipId: assignment.subjectMembershipId,
          ratings,
        },
      );
      if (!response.ok) {
        setMessage(friendlyError(result.error));
        return;
      }
      setMessage(
        `Evaluación de ${assignment.subjectDisplayName} guardada de forma privada.`,
      );
      await loadEvaluationWorkspace();
    } catch {
      setMessage("No se pudo conectar con el sistema.");
    } finally {
      setSubmitting(false);
    }
  }
  async function logout() {
    await requestJson("/api/auth/logout", "POST", {});
    setMessage("");
    setAuditEvents([]);
    setOperations(null);
    setWorkspace(null);
    setView("inicio");
    await refreshAuth();
  }

  const selectedUser =
    auth.users.find(({ id }) => id === selectedUserId) ?? null;
  const activeTeam = auth.team.filter(({ status }) => status === "active");
  const totalFactorHundredths = activeTeam.reduce(
    (sum, member) => sum + member.tipFactorHundredths,
    0,
  );
  const onboarding = onboardingForTeam(auth.team);
  const allowedViews = auth.account
    ? navigationForRole(auth.account.role).map((item) => item.id as AppView)
    : ["inicio" as AppView];
  const currentView = allowedViews.includes(view) ? view : "inicio";
  const navigationItems = navigationForRole(auth.account?.role ?? "worker");
  const mobilePrimaryItems = navigationItems.slice(0, 3);
  const mobileSecondaryItems = navigationItems.slice(3);
  const openView = (target: AppView) => {
    setView(target);
    setMobileMoreOpen(false);
    if (target === "auditoria") void loadAudit();
    if (target === "operacion") void loadOperations();
    if (target === "evaluaciones") void loadEvaluationWorkspace();
  };
  const tipSimulation = useMemo(
    () =>
      activeTeam.length === 0
        ? []
        : allocateTipPoolByExperienceFactors(
            tipPoolPesos,
            activeTeam.map(({ id, tipFactorHundredths }) => ({
              participantId: id,
              factorHundredths: tipFactorHundredths,
            })),
          ),
    [tipPoolPesos, activeTeam],
  );

  if (auth.loading)
    return (
      <main className="access-shell access-loading" aria-busy="true">
        <Brand />
        <p>Preparando el acceso…</p>
      </main>
    );
  if (auth.unavailable)
    return (
      <main className="access-shell">
        <Brand />
        <section className="access-problem" role="alert">
          <span>!</span>
          <h1>La conexión está tardando más de lo esperado</h1>
          <p>
            Ya hicimos varios intentos seguros. Puedes volver a conectar sin
            perder información.
          </p>
          <button className="primary" onClick={() => void refreshAuth()}>
            Volver a intentar
          </button>
        </section>
      </main>
    );
  if (!auth.account)
    return (
      <AccessGate
        mode={accessMode}
        setMode={setAccessMode}
        message={message}
        submitting={submitting}
        showSecret={showSecret}
        setShowSecret={setShowSecret}
        submit={submitAccess}
        bootstrapAllowed={auth.bootstrapAllowed}
      />
    );

  const isAdmin = auth.account.role === "admin";
  return (
    <main className="app-shell premium-app">
      <aside className="sidebar service-rail">
        <Brand />
        <div className="service-constellation" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <nav className="desktop-service-nav" aria-label="Navegación principal">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              className={currentView === item.id ? "active" : ""}
              aria-current={currentView === item.id ? "page" : undefined}
              onClick={() => openView(item.id as AppView)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-note verified-note">
          <span>Datos reales</span>
          <p>Cuentas, turnos y evaluaciones provienen exclusivamente de D1.</p>
        </div>
        <div className="profile">
          <div className="avatar small">
            {initials(auth.account.displayName)}
          </div>
          <div>
            <strong>{auth.account.displayName}</strong>
            <span>{isAdmin ? "Administrador" : "Trabajador"}</span>
          </div>
          <button
            className="logout-button"
            type="button"
            aria-label="Cerrar sesión"
            onClick={() => void logout()}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div
        className={`mobile-more-layer ${mobileMoreOpen ? "is-open" : ""}`}
        aria-hidden={!mobileMoreOpen}
      >
        <button
          className="mobile-more-backdrop"
          type="button"
          aria-label="Cerrar más opciones"
          onClick={() => setMobileMoreOpen(false)}
        />
        <section
          id="mobile-more-panel"
          className="mobile-more-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Más opciones"
        >
          <header>
            <div className="avatar small">{initials(auth.account.displayName)}</div>
            <div>
              <strong>{auth.account.displayName}</strong>
              <span>{isAdmin ? "Administración" : "Cuenta personal"}</span>
            </div>
            <button
              className="mobile-more-close"
              type="button"
              aria-label="Cerrar más opciones"
              onClick={() => setMobileMoreOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="mobile-more-options">
            {!isAdmin && (
              <button type="button" onClick={() => openView("inicio")}>
                <span>◌</span>
                <strong>Mi perfil</strong>
                <small>Datos personales</small>
              </button>
            )}
            {mobileSecondaryItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={currentView === item.id ? "active" : ""}
                onClick={() => openView(item.id as AppView)}
              >
                <span>{item.icon}</span>
                <strong>{item.label}</strong>
                <small>Abrir sección</small>
              </button>
            ))}
          </div>
          <button
            className="mobile-sheet-logout"
            type="button"
            onClick={() => void logout()}
          >
            <span>↗</span>
            Cerrar sesión
          </button>
        </section>
      </div>
      <nav className="mobile-service-nav" aria-label="Navegación móvil">
        {mobilePrimaryItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={currentView === item.id ? "active" : ""}
            aria-current={currentView === item.id ? "page" : undefined}
            onClick={() => openView(item.id as AppView)}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={
            mobileMoreOpen || mobileSecondaryItems.some(({ id }) => id === currentView)
              ? "active"
              : ""
          }
          aria-expanded={mobileMoreOpen}
          aria-controls="mobile-more-panel"
          onClick={() => setMobileMoreOpen((open) => !open)}
        >
          <span>•••</span>
          Más
        </button>
      </nav>
      <section className="content service-desk">
        <div className="data-banner" role="status">
          <strong>Sesión real activa</strong>
          <span>
            {auth.account.displayName} está conectado con permisos de{" "}
            {isAdmin ? "administración" : "trabajador"}.
          </span>
        </div>
        <header className="topbar">
          <div>
            <p className="eyebrow">LIBRETA DE SERVICIO</p>
            <h1>{isAdmin ? "Dirección de servicio" : "Mi jornada"}</h1>
          </div>
          <span className="status complete">
            {isAdmin ? "Control privado" : "Acceso personal"}
          </span>
        </header>
        {message && (
          <div className="global-message" role="status">
            {message}
            <button onClick={() => setMessage("")} aria-label="Cerrar mensaje">
              ×
            </button>
          </div>
        )}
        {currentView === "inicio" &&
          (isAdmin ? (
            <AdminHome
              onboarding={onboarding}
              team={auth.team}
              totalFactor={totalFactorHundredths}
              goTeam={() => setView("equipo")}
              goOperations={() => {
                setView("operacion");
                void loadOperations();
              }}
            />
          ) : (
            <WorkerHome
              account={auth.account}
              team={auth.team}
              submitting={submitting}
              updateProfile={updateOwnProfile}
              updateAvatar={updateOwnAvatar}
            />
          ))}
        {isAdmin && currentView === "equipo" && (
          <TeamAdmin
            users={auth.users}
            selectedUser={selectedUser}
            submitting={submitting}
            selectUser={setSelectedUserId}
            submitAdmin={submitAdmin}
            changeStatus={changeStatus}
            deleteUser={deleteUser}
            purgeHistory={purgeHistory}
          />
        )}
        {isAdmin && currentView === "operacion" && (
          <AdminOperations
            operations={operations}
            loading={workspaceLoading}
            submitting={submitting}
            submitCycle={submitCycle}
            submitShift={submitShift}
            submitShiftDelete={submitShiftDelete}
            shiftRemoval={shiftRemoval}
            chooseShiftRemoval={(shift) =>
              dispatchShiftRemoval({
                type: "choose",
                target: {
                  id: shift.id,
                  startsAt: shift.startsAt,
                  endsAt: shift.endsAt,
                  memberCount: shift.memberCount,
                },
              })
            }
            cancelShiftRemoval={() =>
              dispatchShiftRemoval({ type: "cancel" })
            }
            dismissShiftRemovalSuccess={() =>
              dispatchShiftRemoval({ type: "dismiss-success" })
            }
            submitEvaluationModeration={submitEvaluationModeration}
            submitHistoryDelete={submitHistoryDelete}
            shiftConfirmation={shiftConfirmation}
            dismissShiftConfirmation={() => setShiftConfirmation(null)}
            submitCycleClose={submitCycleClose}
            submitCycleDelete={submitCycleDelete}
          />
        )}
        {isAdmin && currentView === "credenciales" && (
          <CredentialsAdmin
            users={auth.users}
            submitting={submitting}
            submitAdmin={submitAdmin}
          />
        )}
        {isAdmin && currentView === "auditoria" && (
          <AuditTimeline events={auditEvents} loading={auditLoading} />
        )}
        {!isAdmin && currentView === "evaluaciones" && (
          <EvaluationDesk
            workspace={workspace}
            loading={workspaceLoading}
            unavailable={workspaceUnavailable}
            submitting={submitting}
            retry={loadEvaluationWorkspace}
            submitEvaluation={submitEvaluation}
          />
        )}
        {currentView === "acuerdo" && (
          <TipWorkspace
            team={activeTeam}
            totalFactor={totalFactorHundredths}
            pool={tipPoolPesos}
            setPool={setTipPoolPesos}
            simulation={tipSimulation}
          />
        )}
      </section>
    </main>
  );
}

function Brand() {
  return (
    <div className="access-brand brand">
      <span className="brand-mark">☆</span>
      <div>
        <strong>Estrellas</strong>
        <span>del Equipo</span>
      </div>
    </div>
  );
}
function SecretField({
  name,
  label,
  autoComplete,
  show,
  toggle,
  autoFocus = false,
}: {
  name: string;
  label: string;
  autoComplete: string;
  show: boolean;
  toggle(): void;
  autoFocus?: boolean;
}) {
  return (
    <label>
      {label}
      <div className="secret-input">
        <input
          name={name}
          type={show ? "text" : "password"}
          required
          minLength={name === "accessKey" ? 20 : 12}
          maxLength={name === "accessKey" ? 200 : 128}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={
            show
              ? `Ocultar ${label.toLowerCase()}`
              : `Mostrar ${label.toLowerCase()}`
          }
        >
          {show ? "Ocultar" : "Ver"}
        </button>
      </div>
    </label>
  );
}
function FormHead({
  step,
  title,
  text,
}: {
  step: string;
  title: string;
  text: string;
}) {
  return (
    <div className="access-form-heading">
      <span className="form-emblem">✦</span>
      <div>
        <span className="section-kicker">{step}</span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}
function SubmitButton({
  busy,
  label,
  busyLabel = "Guardando…",
}: {
  busy: boolean;
  label: string;
  busyLabel?: string;
}) {
  return (
    <button className="access-submit" disabled={busy}>
      <span>{busy ? busyLabel : label}</span>
      <b>→</b>
    </button>
  );
}

function AccessGate({
  mode,
  setMode,
  message,
  submitting,
  showSecret,
  setShowSecret,
  submit,
  bootstrapAllowed,
}: {
  mode: AccessMode;
  setMode(mode: AccessMode): void;
  message: string;
  submitting: boolean;
  showSecret: boolean;
  setShowSecret(value: boolean): void;
  submit(event: FormEvent<HTMLFormElement>, path: string): Promise<void>;
  bootstrapAllowed: boolean;
}) {
  const recovery = mode === "recovery-key" || mode === "recovery-password";
  const compactDesktopLogin = useSyncExternalStore(
    subscribeFinePointer,
    hasFinePointer,
    () => false,
  );
  const [accessExpanded, setAccessExpanded] = useState(false);
  const consoleOpen =
    bootstrapAllowed || recovery || !compactDesktopLogin || accessExpanded;
  const canCollapse = compactDesktopLogin && !bootstrapAllowed && !recovery;
  const consoleTitle = bootstrapAllowed
    ? "Configurar administración"
    : recovery
      ? "Recuperar administración"
      : "Iniciar sesión";
  return (
    <main className="access-shell premium-access">
      <div className="access-aurora" aria-hidden="true" />
      <div className="access-constellation" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <header className="access-header">
        <Brand />
        <span>Acceso del equipo</span>
      </header>
      <section className="access-stage">
        <div className="access-intro">
          <span className="access-kicker">
            {bootstrapAllowed
              ? "Apertura protegida"
              : recovery
                ? "Recuperación protegida"
                : "Bienvenido de vuelta"}
          </span>
          <h1>
            {bootstrapAllowed
              ? "Activa la administración una sola vez."
              : recovery
                ? "Recupera el control sin perder tus datos."
                : "Tu jornada empieza aquí."}
          </h1>
          <p>
            {bootstrapAllowed
              ? "Valida la clave única y registra la única cuenta administradora."
              : recovery
                ? "La clave única autoriza un cambio durante 10 minutos y cerrará las sesiones anteriores."
                : "La administración ya está configurada. Entra con tu cuenta personal; el registro inicial permanece cerrado por seguridad."}
          </p>
          <div className="access-trust">
            <span>Contraseña protegida</span>
            <span>Sesión privada</span>
            <span>Auditoría activa</span>
          </div>
        </div>
        <div
          className={`access-console ${consoleOpen ? "is-expanded" : ""} ${recovery ? "is-recovery" : ""}`}
          onFocus={() => setAccessExpanded(true)}
        >
          <button
            className="access-console-trigger"
            type="button"
            aria-expanded={consoleOpen}
            aria-controls="access-console-content"
            disabled={!canCollapse}
            onClick={() => setAccessExpanded((current) => !current)}
          >
            <span className="console-sigil" aria-hidden="true">✦</span>
            <span className="console-trigger-copy">
              <small>ACCESO PROTEGIDO</small>
              <strong>{consoleTitle}</strong>
            </span>
            <span className="console-lock" aria-hidden="true"><i /></span>
          </button>
          {mode === "login" && !bootstrapAllowed && (
            <button
              className="access-recovery-trigger"
              type="button"
              onClick={() => {
                setMode("recovery-key");
                setShowSecret(false);
                setAccessExpanded(true);
              }}
            >
              <span className="recovery-key" aria-hidden="true"><i /></span>
              <span>
                <small>SOLO ADMINISTRADOR</small>
                <strong>Recuperar administración</strong>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          )}
          <div className="access-console-body">
            <div className="access-console-content" id="access-console-content">
        {mode === "setup-key" && (
          <form
            className="access-form"
            onSubmit={(event) =>
              void submit(event, "/api/auth/bootstrap/unlock")
            }
          >
            <FormHead
              step="PASO 1 DE 2"
              title="Clave única de acceso"
              text="Solo la persona responsable puede abrir el registro inicial."
            />
            <SecretField
              name="accessKey"
              label="Clave única"
              autoComplete="one-time-code"
              show={showSecret}
              toggle={() => setShowSecret(!showSecret)}
              autoFocus
            />
            <SubmitButton busy={submitting} label="Validar y continuar" />
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
          </form>
        )}
        {mode === "setup-account" && (
          <form
            className="access-form"
            onSubmit={(event) => void submit(event, "/api/auth/bootstrap")}
          >
            <FormHead
              step="PASO 2 DE 2"
              title="Cuenta administradora"
              text="Al guardar, el registro inicial quedará cerrado."
            />
            <label>
              Nombre del restaurante
              <input
                name="organizationName"
                required
                minLength={2}
                maxLength={120}
              />
            </label>
            <label>
              Tu nombre o alias
              <input
                name="displayName"
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label>
              Usuario
              <input
                name="loginIdentifier"
                required
                minLength={3}
                maxLength={80}
                autoComplete="username"
              />
            </label>
            <SecretField
              name="password"
              label="Contraseña"
              autoComplete="new-password"
              show={showSecret}
              toggle={() => setShowSecret(!showSecret)}
            />
            <SubmitButton
              busy={submitting}
              label="Crear cuenta administradora"
            />
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
          </form>
        )}
        {mode === "login" && (
          <form
            className="access-form"
            onSubmit={(event) => void submit(event, "/api/auth/login")}
          >
            <FormHead
              step="ACCESO PERSONAL"
              title="Iniciar sesión"
              text="Usa el usuario asignado a tu cuenta."
            />
            <label>
              Usuario
              <input
                name="loginIdentifier"
                required
                autoComplete="username"
              />
            </label>
            <SecretField
              name="password"
              label="Contraseña"
              autoComplete="current-password"
              show={showSecret}
              toggle={() => setShowSecret(!showSecret)}
            />
            <SubmitButton
              busy={submitting}
              label="Entrar al sistema"
              busyLabel="Ingresando…"
            />
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
          </form>
        )}
        {mode === "recovery-key" && (
          <form
            className="access-form"
            onSubmit={(event) =>
              void submit(event, "/api/auth/recovery/unlock")
            }
          >
            <FormHead
              step="RECUPERACIÓN · PASO 1"
              title="Validar clave única"
              text="No se cambiará ninguna cuenta hasta completar el siguiente paso."
            />
            <SecretField
              name="accessKey"
              label="Clave única"
              autoComplete="one-time-code"
              show={showSecret}
              toggle={() => setShowSecret(!showSecret)}
              autoFocus
            />
            <SubmitButton busy={submitting} label="Autorizar recuperación" />
            <button
              className="recovery-back-action"
              type="button"
              onClick={() => setMode("login")}
            >
              <span className="recovery-back-icon" aria-hidden="true">
                ←
              </span>
              <span className="recovery-back-copy">
                <small>Salir de recuperación</small>
                <strong>Volver al inicio de sesión</strong>
              </span>
              <span className="recovery-back-chevron" aria-hidden="true">
                ◇
              </span>
            </button>
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
          </form>
        )}
        {mode === "recovery-password" && (
          <form
            className="access-form"
            onSubmit={(event) =>
              void submit(event, "/api/auth/recovery/complete")
            }
          >
            <FormHead
              step="RECUPERACIÓN · PASO 2"
              title="Nueva contraseña"
              text="Indica el usuario administrador existente y reemplaza su contraseña."
            />
            <label>
              Usuario administrador
              <input
                name="loginIdentifier"
                required
                minLength={3}
                maxLength={80}
                autoComplete="username"
                autoFocus
              />
            </label>
            <SecretField
              name="newPassword"
              label="Nueva contraseña"
              autoComplete="new-password"
              show={showSecret}
              toggle={() => setShowSecret(!showSecret)}
            />
            <SubmitButton
              busy={submitting}
              label="Cambiar contraseña y cerrar sesiones"
            />
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
          </form>
        )}
            </div>
          </div>
        </div>
      </section>
      <footer className="access-footer">
        <span>Uso interno del equipo</span>
        <span>Sin identidades ni resultados inventados.</span>
      </footer>
    </main>
  );
}

function AdminHome({
  onboarding,
  team,
  totalFactor,
  goTeam,
  goOperations,
}: {
  onboarding: ReturnType<typeof onboardingForTeam>;
  team: TeamMember[];
  totalFactor: number;
  goTeam(): void;
  goOperations(): void;
}) {
  const active = team.filter((member) => member.status === "active").length;
  return (
    <>
      <section className="hero admin-hero">
        <div className="hero-copy">
          <span className="pill brass">MESA DE CONTROL</span>
          <h2>Dirige el servicio con hechos, no con suposiciones.</h2>
          <p>
            Administra cuentas y factores; abre ciclos y registra turnos para
            que las evaluaciones entre compañeros tengan un contexto real.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={goOperations}>
              Preparar evaluaciones <span>→</span>
            </button>
            <button className="secondary" onClick={goTeam}>
              Gestionar equipo
            </button>
          </div>
        </div>
        <article className="setup-card">
          <span className="section-kicker">INCORPORACIÓN ABIERTA</span>
          <strong>{onboarding.created} cuentas reales</strong>
          <p>{onboarding.next}</p>
          <div className="onboarding-note">
            <span>∞</span>
            <small>Sin máximo de trabajadores</small>
          </div>
        </article>
      </section>
      <section className="metric-grid real-metrics">
        <Metric
          icon="♙"
          label="Registrados"
          value={String(team.length)}
          note="Registros de D1"
        />
        <Metric
          icon="✓"
          label="Activos"
          value={String(active)}
          note="Con acceso vigente"
        />
        <Metric
          icon="◎"
          label="Factor activo"
          value={formatExperienceFactor(totalFactor)}
          note="Puntos de experiencia"
        />
        <Metric
          icon="☆"
          label="Administrador evalúa"
          value="No"
          note="Separación acordada"
        />
      </section>
    </>
  );
}
function WorkerHome({
  account,
  team,
  submitting,
  updateProfile,
  updateAvatar,
}: {
  account: Account;
  team: TeamMember[];
  submitting: boolean;
  updateProfile(event: FormEvent<HTMLFormElement>): Promise<void>;
  updateAvatar(file: File | null): Promise<void>;
}) {
  const profile = team.find((member) => member.id === account.userId);
  return (
    <div className="worker-home-stack">
      <section className="hero worker-hero">
        <div className="hero-copy">
          <span className="pill brass">JORNADA PERSONAL</span>
          <h2>Bienvenido, {account.displayName}.</h2>
          <p>Tu cuenta identifica tus acciones. Las evaluaciones solo se habilitan cuando exista un período y un turno real compartido.</p>
        </div>
        <article className="setup-card">
          <span className="section-kicker">EQUIPO VISIBLE</span>
          <strong>{team.filter((member) => member.status === "active").length} cuentas activas</strong>
          <p>Los factores mostrados en Propinas provienen del acuerdo registrado por administración.</p>
        </article>
      </section>
      {profile && (
        <form className="panel account-form own-profile" onSubmit={(event) => void updateProfile(event)}>
          <div className="profile-editor-heading">
            <ProfileAvatar member={profile} className="profile-preview" />
            <div><span className="section-kicker">MI PERFIL</span><h3>Datos profesionales</h3><small>Tú decides si deseas usar una foto.</small></div>
          </div>
          <div className="own-profile-grid">
            <label>Correo personal<input name="email" type="email" maxLength={254} defaultValue={profile.email ?? ""} autoComplete="email" /></label>
            <label>Teléfono<input name="phone" type="tel" maxLength={32} defaultValue={profile.phone ?? ""} autoComplete="tel" /></label>
            <label>Fecha de ingreso<input name="hiredOn" type="date" defaultValue={profile.hiredOn ?? ""} /></label>
            <label className="profile-bio">Presentación profesional<textarea name="bio" maxLength={500} rows={3} defaultValue={profile.bio ?? ""} /></label>
          </div>
          <label className="avatar-upload">Foto opcional<input type="file" accept="image/jpeg,image/png,image/webp" disabled={submitting} onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; if (file) void updateAvatar(file); }} /><small>Se recorta y optimiza antes de enviarse.</small></label>
          <div className="form-actions">
            <button className="primary" disabled={submitting}>Guardar mi perfil</button>
            {profile.hasAvatar && <button className="secondary" type="button" disabled={submitting} onClick={() => void updateAvatar(null)}>Quitar foto</button>}
          </div>
        </form>
      )}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  note,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article>
      <div className="metric-icon gold">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function TeamAdmin({
  users,
  selectedUser,
  submitting,
  selectUser,
  submitAdmin,
  changeStatus,
  deleteUser,
  purgeHistory,
}: {
  users: StoredUser[];
  selectedUser: StoredUser | null;
  submitting: boolean;
  selectUser(id: string | null): void;
  submitAdmin(
    event: FormEvent<HTMLFormElement>,
    path: string,
    method?: "POST" | "PATCH",
  ): Promise<void>;
  changeStatus(user: StoredUser): Promise<void>;
  deleteUser(user: StoredUser, confirmation: string): Promise<boolean>;
  purgeHistory(event: FormEvent<HTMLFormElement>): Promise<void>;
}) {
  const [deleteTarget, setDeleteTarget] = useState<StoredUser | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  async function confirmDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget) return;
    if (await deleteUser(deleteTarget, deleteConfirmation)) {
      setDeleteTarget(null);
      setDeleteConfirmation("");
    }
  }

  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h2>Equipo</h2>
          <span>Crea y modifica únicamente cuentas reales.</span>
        </div>
        <span className="status complete">{users.length} registrados</span>
      </div>
      <div className="admin-workbench">
        <form
          className="panel account-form"
          onSubmit={(event) => void submitAdmin(event, "/api/admin/users")}
        >
          <div>
            <span className="section-kicker">NUEVA CUENTA</span>
            <h3>Agregar trabajador</h3>
          </div>
          <WorkerFields />
          <label>
            Contraseña inicial
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <button className="primary full" disabled={submitting}>
            Crear cuenta
          </button>
        </form>
        {selectedUser ? (
          <form
            key={selectedUser.id}
            className="panel account-form"
            onSubmit={(event) =>
              void submitAdmin(
                event,
                `/api/admin/users/${selectedUser.id}`,
                "PATCH",
              )
            }
          >
            <div>
              <span className="section-kicker">EDICIÓN SEGURA</span>
              <h3>{selectedUser.displayName}</h3>
            </div>
             <WorkerFields user={selectedUser} />
            <div className="form-actions">
              <button className="primary" disabled={submitting}>
                Guardar cambios
              </button>
               <button
                className="secondary"
                type="button"
                onClick={() => selectUser(null)}
              >
                 Cancelar
               </button>
            </div>
          </form>
        ) : (
          <article className="panel empty-summary">
            <span className="section-kicker">EDICIÓN</span>
            <h3>Selecciona una cuenta</h3>
            <p>
              Podrás corregir nombre, usuario, cargo y factor. Cada cambio queda
              registrado.
            </p>
          </article>
        )}
      </div>
      {users.length === 0 ? (
        <Empty
          title="Aún no has agregado trabajadores"
          text="Crea la primera cuenta con sus datos y credenciales reales."
        />
      ) : (
        <div className="worker-card-grid">
          {users.map((user) => (
            <article
              className={`worker-card ${user.status !== "active" ? "is-suspended" : ""}`}
              key={user.id}
            >
              <div className="worker-identity">
                <ProfileAvatar member={user} />
                <div>
                  <strong>{user.displayName}</strong>
                  <small>
                    @{user.loginIdentifier} · {jobTitles[user.jobTitle]}
                  </small>
                </div>
              </div>
              <div className="worker-facts">
                <span>
                  Factor{" "}
                  <b>{formatExperienceFactor(user.tipFactorHundredths)}</b>
                </span>
                <span
                  className={
                    user.status === "active"
                      ? "permission yes"
                      : "permission no"
                  }
                >
                  {statusLabel(user.status)}
                </span>
              </div>
              <div className="worker-actions">
                <button
                  className="secondary"
                  onClick={() => selectUser(user.id)}
                >
                  Editar
                </button>
                <button
                  className={
                    user.status === "active" ? "danger-action" : "secondary"
                  }
                  disabled={submitting}
                  onClick={() => void changeStatus(user)}
                >
                  {user.status === "active" ? "Suspender" : "Reactivar"}
                </button>
                <button
                  className="delete-account-action"
                  disabled={submitting}
                  onClick={() => {
                    setDeleteTarget(user);
                    setDeleteConfirmation("");
                  }}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {deleteTarget && (
        <div className="confirmation-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDeleteTarget(null);
        }}>
          <form className="account-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="account-delete-title" onSubmit={(event) => void confirmDelete(event)}>
            <header>
              <span className="danger-emblem" aria-hidden="true">×</span>
              <div>
                <span className="section-kicker">ELIMINACIÓN PROTEGIDA</span>
                <h3 id="account-delete-title">Eliminar a {deleteTarget.displayName}</h3>
              </div>
            </header>
            <p>La cuenta perderá el acceso y desaparecerá del equipo. Sus evaluaciones históricas conservarán su nombre para no alterar resultados anteriores.</p>
            <label>
              Escribe <b>{deleteTarget.loginIdentifier}</b> para confirmar
              <input
                autoFocus
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="dialog-actions">
              <button className="secondary" type="button" disabled={submitting} onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button className="delete-account-action" disabled={submitting || deleteConfirmation.trim().toLowerCase() !== deleteTarget.loginIdentifier.toLowerCase()}>Eliminar cuenta</button>
            </div>
          </form>
        </div>
      )}
      <form className="panel reset-zone history-purge-zone" onSubmit={(event) => void purgeHistory(event)}>
        <div>
          <span className="section-kicker">LIMPIEZA OPERATIVA</span>
          <h3>Empezar evaluaciones desde cero</h3>
          <p>Elimina ciclos, criterios, turnos, evaluaciones, resultados, acuerdos históricos y auditoría. Conserva administrador, trabajadores, perfiles, credenciales y porcentajes.</p>
        </div>
        <div className="reset-fields">
          <label>
            Contraseña actual
            <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="current-password" />
            <small>La contraseña con la que ingresaste como administrador.</small>
          </label>
          <label>
            Clave única de configuración inicial
            <input name="accessKey" type="password" required minLength={12} maxLength={128} autoComplete="off" />
            <small>La clave privada usada para crear o recuperar la administración.</small>
          </label>
          <label>
            Confirmación exacta
            <input name="confirmation" required autoComplete="off" placeholder="BORRAR HISTORIAL OPERATIVO" />
            <small>Escribe la frase completa tal como aparece.</small>
          </label>
        </div>
        <button className="danger-action" disabled={submitting}>Borrar historial operativo</button>
      </form>
    </section>
  );
}
function WorkerFields({ user }: { user?: StoredUser }) {
  return (
    <>
      <label>
        Nombre o alias
        <input
          name="displayName"
          required
          minLength={2}
          maxLength={100}
          defaultValue={user?.displayName}
        />
      </label>
      <label>
        Usuario
        <input
          name="loginIdentifier"
          required
          minLength={3}
          maxLength={80}
          defaultValue={user?.loginIdentifier}
          autoComplete="off"
        />
      </label>
      <label>
        Cargo
        <select name="jobTitle" defaultValue={user?.jobTitle ?? "waiter"}>
          <option value="waiter">Garzón</option>
          <option value="bartender">Barman</option>
          <option value="cashier">Cajera</option>
          <option value="head_waiter">Jefe de garzones</option>
        </select>
      </label>
      <label>
        Porcentaje de experiencia
        <input
          name="tipPercentage"
          type="number"
          required
          min={1}
          max={100}
          step={1}
          defaultValue={user?.tipFactorHundredths}
        />
        <small>La cajera debe conservar 50% = 0,50 puntos.</small>
      </label>
    </>
  );
}
function CredentialsAdmin({
  users,
  submitting,
  submitAdmin,
}: {
  users: StoredUser[];
  submitting: boolean;
  submitAdmin(event: FormEvent<HTMLFormElement>, path: string): Promise<void>;
}) {
  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACCESOS PERSONALES</p>
          <h2>Credenciales</h2>
          <span>
            Reemplazar una contraseña cierra todas las sesiones de esa persona.
          </span>
        </div>
      </div>
      {users.length === 0 ? (
        <Empty
          title="No hay credenciales de trabajadores"
          text="Primero crea una cuenta en Equipo."
        />
      ) : (
        <div className="credential-grid">
          {users.map((user) => (
            <form
              className="panel credential-card"
              key={user.id}
              onSubmit={(event) =>
                void submitAdmin(event, `/api/admin/users/${user.id}/password`)
              }
            >
              <div className="worker-identity">
                <ProfileAvatar member={user} />
                <div>
                  <strong>{user.displayName}</strong>
                  <small>@{user.loginIdentifier}</small>
                </div>
              </div>
              <label>
                Nueva contraseña
                <div className="credential-secret">
                  <input
                    name="newPassword"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="Mínimo 12 caracteres"
                  />
                </div>
                <small className="credential-note">Al reemplazarla se cerrarán sus sesiones activas.</small>
              </label>
              <button className="primary full" disabled={submitting}>
                Reemplazar acceso
              </button>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
function AuditTimeline({
  events,
  loading,
}: {
  events: AuditEvent[];
  loading: boolean;
}) {
  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TRAZABILIDAD</p>
          <h2>Auditoría administrativa</h2>
          <span>
            Historial de cambios de cuentas y accesos, sin guardar secretos.
          </span>
        </div>
        <span className="status neutral">Últimos 50</span>
      </div>
      {loading ? (
        <div className="empty-state" aria-busy="true">
          Cargando historial…
        </div>
      ) : events.length === 0 ? (
        <Empty
          title="Aún no hay acciones registradas"
          text="La primera creación o cambio de cuenta aparecerá aquí."
        />
      ) : (
        <ol className="audit-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <span className="audit-dot">◎</span>
              <div>
                <strong>{auditLabels[event.action] ?? event.action}</strong>
                <p>
                  {event.actorDisplayName
                    ? `${event.actorDisplayName} realizó esta acción.`
                    : "Recuperación protegida realizada fuera de sesión."}
                </p>
                <small>
                  {new Intl.DateTimeFormat("es-CL", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "America/Santiago",
                  }).format(new Date(event.createdAt))}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
function AdminOperations({
  operations,
  loading,
  submitting,
  submitCycle,
  submitShift,
  submitShiftDelete,
  shiftRemoval,
  chooseShiftRemoval,
  cancelShiftRemoval,
  dismissShiftRemovalSuccess,
  submitEvaluationModeration,
  submitHistoryDelete,
  shiftConfirmation,
  dismissShiftConfirmation,
  submitCycleClose,
  submitCycleDelete,
}: {
  operations: EvaluationOperations | null;
  loading: boolean;
  submitting: boolean;
  submitCycle(event: FormEvent<HTMLFormElement>): Promise<void>;
  submitShift(event: FormEvent<HTMLFormElement>): Promise<void>;
  submitShiftDelete(event: FormEvent<HTMLFormElement>): Promise<void>;
  shiftRemoval: ShiftRemovalState;
  chooseShiftRemoval(shift: EvaluationOperations["shifts"][number]): void;
  cancelShiftRemoval(): void;
  dismissShiftRemovalSuccess(): void;
  submitEvaluationModeration(
    event: FormEvent<HTMLFormElement>,
    submissionId: string,
    action: "void" | "restore",
  ): Promise<void>;
  submitHistoryDelete(event: FormEvent<HTMLFormElement>): Promise<void>;
  shiftConfirmation: ShiftConfirmation | null;
  dismissShiftConfirmation(): void;
  submitCycleClose(
    event: FormEvent<HTMLFormElement>,
    periodId: string,
  ): Promise<void>;
  submitCycleDelete(
    event: FormEvent<HTMLFormElement>,
    periodId: string,
  ): Promise<void>;
}) {
  const [operationSection, setOperationSection] =
    useState<EvaluationAdminSection>("cycle");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthName = new Intl.DateTimeFormat("es-CL", {
    month: "long",
    year: "numeric",
  }).format(now);
  const dateValue = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (loading && !operations)
    return (
      <div className="empty-state" aria-busy="true">
        Preparando la mesa de control…
      </div>
    );
  const members =
    operations?.members.filter((member) => member.status === "active") ?? [];
  return (
    <section className="data-section operations-page">
      <div className="operations-hero">
        <div>
          <span className="section-kicker">DIRECCIÓN DEL SERVICIO</span>
          <h2>Convierte cada turno real en aprendizaje útil.</h2>
          <p>
            Abre un ciclo mensual, registra quiénes trabajaron juntos y habilita
            evaluaciones privadas. El sistema nunca crea turnos ni puntajes por
            su cuenta.
          </p>
        </div>
        <div className="operations-pulse">
          <span>
            {operations?.period?.status === "open"
              ? "CICLO ACTIVO"
              : operations?.period
                ? "MES EN REVISIÓN"
                : "CONFIGURACIÓN PENDIENTE"}
          </span>
          <strong>{operations?.period?.name ?? "Sin ciclo abierto"}</strong>
          <small>
            {operations?.period
              ? `${operations.period.submissionCount} evaluaciones recibidas`
              : "Se requieren al menos dos trabajadores activos"}
          </small>
        </div>
      </div>
      <nav className="operation-sections" aria-label="Categorías de evaluaciones">
        {evaluationAdminSections({
          shiftCount: operations?.shifts.length ?? 0,
          submissionCount: operations?.submissions.length ?? 0,
        }).map((section) => (
          <button
            type="button"
            key={section.id}
            className={operationSection === section.id ? "active" : ""}
            aria-pressed={operationSection === section.id}
            onClick={() => setOperationSection(section.id)}
          >
            <span>{section.index}</span>
            <strong>{section.label}</strong>
            <small>{section.detail}</small>
          </button>
        ))}
      </nav>
      <div className="operations-grid">
        {operationSection === "cycle" && (operations?.period?.status === "open" ? (
          <article className="panel cycle-card">
            <div className="panel-head">
              <div>
                <span className="section-kicker">CICLO VIGENTE</span>
                <h3>{operations.period.name}</h3>
              </div>
              <span className="status complete">Abierto</span>
            </div>
            <div className="cycle-dates">
              <span>
                <small>Desde</small>
                {formatServiceDate(operations.period.startsAt)}
              </span>
              <i>→</i>
              <span>
                <small>Hasta</small>
                {formatServiceDate(operations.period.endsAt)}
              </span>
            </div>
            <div className="step-explainer">
              <span className="explainer-index">01</span>
              <div>
                <strong>Qué es el ciclo vigente</strong>
                <p>
                  Es el mes que reúne todas las evaluaciones diarias. Cada nota
                  queda dentro de estas fechas y al cierre se calcula el promedio
                  mensual para tu revisión.
                </p>
              </div>
            </div>
            <p>
              Los trabajadores activos participan. El jefe de garzones y la cajera
              pueden evaluar, pero no son evaluados por sus compañeros.
            </p>
            <div className="official-criteria">
              <div className="official-criteria-head">
                <div>
                  <span className="section-kicker">MATRIZ OFICIAL</span>
                  <strong>6 criterios · misma importancia</strong>
                </div>
                <span className="status neutral">Escala 1 a 5</span>
              </div>
              {operations.criteria.map((criterion, index) => (
                <article key={criterion.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{criterion.name}</strong>
                    <p>{criterion.description}</p>
                  </div>
                  <small>Mismo peso</small>
                </article>
              ))}
            </div>
          </article>
        ) : (
          <form
            className="panel operations-form"
            onSubmit={(event) => void submitCycle(event)}
          >
            <div>
              <span className="section-kicker">PASO 1</span>
              <h3>
                {operations?.period
                  ? "Abrir el siguiente mes"
                  : "Abrir evaluación mensual"}
              </h3>
              <p>
                Los seis criterios tienen la misma importancia y el cierre reúne
                únicamente observaciones reales.
              </p>
            </div>
            <label>
              Nombre del mes
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={
                  monthName.charAt(0).toUpperCase() + monthName.slice(1)
                }
              />
            </label>
            <div className="form-split">
              <label>
                Comienza
                <input
                  name="startsOn"
                  type="date"
                  required
                  defaultValue={dateValue(monthStart)}
                />
              </label>
              <label>
                Termina
                <input
                  name="endsOn"
                  type="date"
                  required
                  defaultValue={dateValue(monthEnd)}
                />
              </label>
            </div>
            <button
              className="primary full"
              disabled={submitting || members.length < 2}
            >
              Abrir mes de evaluación
            </button>
            {members.length < 2 && (
              <small className="form-hint">
                Crea al menos dos trabajadores activos antes de abrirlo.
              </small>
            )}
          </form>
        ))}
        {operationSection === "shifts" && operations?.period?.status === "open" && (
          <form
            className="panel operations-form shift-form"
            onSubmit={(event) => void submitShift(event)}
          >
            <div>
              <span className="section-kicker">PASO 2 · DIARIO</span>
              <h3>Registrar turno realizado</h3>
              <div className="step-explainer compact">
                <span className="explainer-index">02</span>
                <div>
                  <strong>Qué registra este paso diario</strong>
                  <p>
                    Indica quiénes trabajaron juntos y durante qué horario. Cada
                    persona seleccionada podrá evaluar a todos sus compañeros
                    evaluables de ese turno mediante estrellas. No es una
                    evaluación: solo habilita los formularios correctos.
                  </p>
                </div>
              </div>
            </div>
            <div className="form-split">
              <label>
                Fecha del turno
                <input name="serviceDate" type="date" required />
              </label>
              <label>
                Hora de inicio
                <input name="startTime" type="time" required />
              </label>
              <label>
                Hora de término
                <input name="endTime" type="time" required />
              </label>
            </div>
            <small className="form-hint">
              Si termina después de medianoche, usa una hora menor que la de
              inicio. El sistema reconocerá automáticamente el día siguiente.
            </small>
            <fieldset className="member-selector">
              <legend>Personas que trabajaron juntas</legend>
              {members.map((member) => (
                <label key={member.membershipId}>
                  <input
                    type="checkbox"
                    name="membershipIds"
                    value={member.membershipId}
                    defaultChecked
                  />
                  <span>
                    <b>{member.displayName}</b>
                    <small>
                      {jobTitles[member.jobTitle]}
                      {member.canBeEvaluated
                        ? " · evalúa y es evaluado/a"
                        : " · evalúa, no es evaluado/a"}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <small className="form-hint">
              Todos están seleccionados inicialmente. Desmarca solamente a quien
              no haya trabajado ese turno.
            </small>
            <button className="primary full" disabled={submitting}>
              Registrar turno y habilitar evaluaciones
            </button>
            {shiftConfirmation && (
              <ShiftRegistrationConfirmation
                confirmation={shiftConfirmation}
                onDismiss={dismissShiftConfirmation}
              />
            )}
          </form>
        )}
      </div>
      {operationSection === "shifts" && operations?.period?.status !== "open" && (
        <Empty
          title="Primero abre un ciclo mensual"
          text="Cuando el ciclo esté abierto podrás registrar aquí cada turno real y habilitar las evaluaciones correspondientes."
        />
      )}
      {operationSection === "cycle" && (
        <MonthlyEvaluationSummary summary={operations?.summary ?? null} />
      )}
      {operationSection === "close" && operations?.period?.status === "open" && (
        <form
          className="cycle-close-panel"
          onSubmit={(event) =>
            void submitCycleClose(event, operations.period!.id)
          }
        >
          <div>
            <span className="section-kicker">CIERRE DEL MES</span>
            <h3>Bloquear evaluaciones y revisar el resultado</h3>
            <p>
              Este paso impide nuevas notas. Ningún porcentaje de propina cambia
              hasta que tú edites y apruebes el factor de la persona.
            </p>
          </div>
          <label>
            Motivo del cierre
            <input
              name="reason"
              required
              minLength={4}
              maxLength={240}
              placeholder="Ej.: Cierre mensual revisado"
            />
          </label>
          <button className="secondary" disabled={submitting}>
            Cerrar mes para revisión
          </button>
        </form>
      )}
      {operationSection === "control" && operations?.period?.status === "open" && (
        <form
          className="cycle-close-panel cycle-delete-panel"
          onSubmit={(event) =>
            void submitCycleDelete(event, operations.period!.id)
          }
        >
          <div>
            <span className="section-kicker">ZONA DE CONTROL</span>
            <h3>Eliminar definitivamente este ciclo</h3>
            <p>
              Borra sus turnos, evaluaciones y criterios. No elimina personas,
              accesos ni factores de propina. La acción queda registrada.
            </p>
          </div>
          <div className="cycle-delete-fields">
            <label>
              Confirmación exacta
              <input
                name="confirmation"
                required
                autoComplete="off"
                placeholder="CONFIRMO ELIMINAR CICLO ANTIGUO"
              />
            </label>
            <label>
              Motivo
              <input
                name="reason"
                required
                minLength={8}
                maxLength={240}
                placeholder="Ej.: Reemplazo por el ciclo oficial"
              />
            </label>
          </div>
          <button className="danger-action" disabled={submitting}>
            Eliminar ciclo antiguo
          </button>
        </form>
      )}
      {operationSection === "close" && operations?.period?.status !== "open" && (
        <Empty
          title="No hay un ciclo abierto para cerrar"
          text="Abre un ciclo mensual antes de usar el cierre del mes."
        />
      )}
      {operationSection === "control" && operations?.period?.status !== "open" && (
        <Empty
          title="No hay un ciclo abierto para administrar"
          text="La zona de control se habilita cuando existe un ciclo mensual abierto."
        />
      )}
      {operationSection === "history" && (
      <section className="history-control">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CONTROL ADMINISTRATIVO</p>
            <h2>Historial de evaluaciones</h2>
            <span>Anula errores sin alterar silenciosamente las estrellas originales. Cada decisión queda auditada.</span>
          </div>
          <span className="status neutral">{operations?.submissions.length ?? 0} registros</span>
        </div>
        <form className="panel history-bulk-form" onSubmit={(event) => void submitHistoryDelete(event)}>
          <div>
            <span className="section-kicker">ANULACIÓN POR PERSONA</span>
            <h3>Retirar todo un historial seleccionado</h3>
            <p>Puedes retirar evaluaciones recibidas, emitidas o ambas. Los registros permanecen visibles como anulados para proteger la trazabilidad.</p>
          </div>
          <div className="history-bulk-grid">
            <label>
              Persona
              <select name="membershipId" required defaultValue="">
                <option value="" disabled>Selecciona una persona</option>
                {operations?.members.map((member) => <option key={member.membershipId} value={member.membershipId}>{member.displayName}</option>)}
              </select>
            </label>
            <label>
              Qué historial retirar
              <select name="scope" required defaultValue="received">
                <option value="received">Evaluaciones recibidas</option>
                <option value="authored">Evaluaciones realizadas</option>
                <option value="all">Todo: recibidas y realizadas</option>
              </select>
            </label>
            <label>
              Confirmación exacta
              <input name="confirmation" required autoComplete="off" placeholder="ANULAR HISTORIAL" />
            </label>
            <label>
              Motivo obligatorio
              <input name="reason" required minLength={8} maxLength={240} placeholder="Ej.: Evaluación creada antes del acuerdo vigente" />
            </label>
          </div>
          <button className="danger-action" disabled={submitting}>Anular historial seleccionado</button>
        </form>
        {!operations?.submissions.length ? (
          <Empty title="No hay evaluaciones registradas" text="Cuando alguien complete una evaluación aparecerá aquí con sus controles administrativos." />
        ) : (
          <div className="history-list">
            {operations.submissions.map((submission) => {
              const subjectCanBeEvaluated = operations.members.find((member) => member.membershipId === submission.subjectMembershipId)?.canBeEvaluated ?? false;
              return (
                <article key={submission.id} className={submission.status === "voided" ? "voided" : ""}>
                  <div className="history-route"><strong>{submission.raterDisplayName}</strong><span>→</span><strong>{submission.subjectDisplayName}</strong></div>
                  <p>{submission.periodName} · {formatServiceDate(submission.shiftStartsAt)}</p>
                  <div className="history-meta">
                    <span className={`status ${submission.status === "voided" ? "neutral" : "complete"}`}>{submission.status === "voided" ? "Anulada" : "Vigente"}</span>
                    <b>{submission.score === null ? "Sin puntuación" : `${submission.score.toFixed(2)} de 5`}</b>
                  </div>
                  <form onSubmit={(event) => void submitEvaluationModeration(event, submission.id, submission.status === "voided" ? "restore" : "void")}>
                    <input name="reason" required minLength={8} maxLength={240} defaultValue={submission.status === "voided" ? "Restauración revisada por administración" : "Anulación revisada por administración"} aria-label={`Motivo para ${submission.status === "voided" ? "restaurar" : "anular"} la evaluación de ${submission.subjectDisplayName}`} />
                    <button className={submission.status === "voided" ? "secondary" : "danger-action"} disabled={submitting || (submission.status === "voided" && !subjectCanBeEvaluated)}>
                      {submission.status === "voided" ? (subjectCanBeEvaluated ? "Restaurar evaluación" : "No restaurable por acuerdo") : "Anular evaluación"}
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}
      {operationSection === "shifts" && (
      <section className="shift-ledger">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BITÁCORA</p>
            <h2>Turnos registrados</h2>
            <span>
              Cada turno define exactamente quién puede evaluar a quién.
            </span>
          </div>
          <span className="status neutral">
            {operations?.shifts.length ?? 0} registros
          </span>
        </div>
        {shiftRemoval.success && (
          <section
            className="shift-removal-success"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Registro actualizado</strong>
              <p>{shiftRemoval.success}</p>
            </div>
            <button
              type="button"
              onClick={dismissShiftRemovalSuccess}
              aria-label="Cerrar confirmación de turno eliminado"
            >
              ×
            </button>
          </section>
        )}
        {!operations?.shifts.length ? (
          <Empty
            title="Todavía no hay turnos"
            text="Cuando registres el primer servicio real, aparecerá aquí y en las cuentas de sus participantes."
          />
        ) : (
          <div className="shift-grid">
            {operations.shifts.map((shift) => (
              <article key={shift.id}>
                <span className="shift-mark">✦</span>
                <div>
                  <strong>{shift.section}</strong>
                  <p>
                    {formatServiceDate(shift.startsAt)} ·{" "}
                    {formatServiceTime(shift.startsAt)}–
                    {formatServiceTime(shift.endsAt)}
                  </p>
                </div>
                <div className="shift-actions">
                  <span className="shift-ledger-status">
                    <b>{shift.memberCount} personas</b>
                    <small>Evaluaciones habilitadas</small>
                  </span>
                  <button
                    type="button"
                    className="danger-action"
                    disabled={shiftRemoval.status === "submitting"}
                    onClick={() => chooseShiftRemoval(shift)}
                  >
                    Eliminar turno
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {shiftRemoval.target && (
          <ShiftRemovalDialog
            state={shiftRemoval}
            onCancel={cancelShiftRemoval}
            onSubmit={submitShiftDelete}
          />
        )}
      </section>
      )}
    </section>
  );
}

function ShiftRemovalDialog({
  state,
  onCancel,
  onSubmit,
}: {
  state: ShiftRemovalState;
  onCancel(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): Promise<void>;
}) {
  if (!state.target) return null;
  const busy = state.status === "submitting";
  return (
    <div className="confirmation-backdrop" role="presentation">
      <section
        className="shift-removal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-removal-title"
        aria-describedby="shift-removal-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <header>
          <span className="confirmation-seal" aria-hidden="true">!</span>
          <div>
            <span className="section-kicker">CONFIRMACIÓN REQUERIDA</span>
            <h3 id="shift-removal-title">¿Eliminar este turno registrado?</h3>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancelar eliminación del turno"
          >
            ×
          </button>
        </header>
        <div className="shift-removal-summary">
          <span>Turno general</span>
          <strong>
            {formatServiceDate(state.target.startsAt)} ·{" "}
            {formatServiceTime(state.target.startsAt)}–
            {formatServiceTime(state.target.endsAt)}
          </strong>
          <small>{state.target.memberCount} personas registradas</small>
        </div>
        <p id="shift-removal-description" className="dialog-warning">
          Se quitará este turno de las jornadas de sus participantes. Las cuentas
          y el ciclo mensual no se eliminarán. Si ya existen evaluaciones, el
          sistema protegerá el historial y no realizará ningún cambio.
        </p>
        <form onSubmit={(event) => void onSubmit(event)}>
          <label>
            Motivo de la eliminación
            <textarea
              name="reason"
              required
              minLength={8}
              maxLength={240}
              defaultValue="Turno registrado con fechas incorrectas"
              autoFocus
            />
            <small>Este motivo quedará registrado en la auditoría.</small>
          </label>
          {state.error && (
            <div className="shift-removal-error" role="alert">
              <strong>No se eliminó el turno</strong>
              <p>{state.error}</p>
            </div>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={onCancel}
              disabled={busy}
            >
              Conservar turno
            </button>
            <button className="danger-confirm" disabled={busy}>
              {busy ? "Eliminando…" : "Sí, eliminar turno"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

interface ShiftRegistrationConfirmationProps {
  confirmation: ShiftConfirmation;
  onDismiss(): void;
}

function ShiftRegistrationConfirmation({
  confirmation,
  onDismiss,
}: ShiftRegistrationConfirmationProps) {
  return (
    <section
      className="turn-confirmation"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="turn-confirmation-icon" aria-hidden="true">✓</span>
      <div>
        <span className="section-kicker">REGISTRO COMPLETADO</span>
        <strong>Turno registrado correctamente</strong>
        <p>
          {formatServiceDate(confirmation.startsAt)} ·{" "}
          {formatServiceTime(confirmation.startsAt)}–
          {formatServiceTime(confirmation.endsAt)}
        </p>
        <small>
          Evaluaciones habilitadas para {confirmation.participantNames.length}{" "}
          participante{confirmation.participantNames.length === 1 ? "" : "s"}
          {confirmation.participantNames.length > 0
            ? `: ${confirmation.participantNames.join(", ")}.`
            : "."}
        </small>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Cerrar confirmación">
        ×
      </button>
    </section>
  );
}

function MonthlyEvaluationSummary({
  summary,
}: {
  summary: EvaluationSummary | null;
}) {
  if (!summary) return null;
  const completion = evaluationCompletionState(summary);
  const evaluatedResults = summary.results.filter(
    (result) => result.completedSubmissions > 0,
  );
  return (
    <section className="monthly-summary">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PROMEDIO DEL MES</p>
          <h2>Resultados reales y cumplimiento diario</h2>
          <span>
            Los días sin respuesta siguen pendientes. Para el promedio mensual
            se muestra aparte una estimación basada solo en días anteriores;
            nunca cuenta como una evaluación enviada.
          </span>
        </div>
        <span
          className={`status ${completion.pendingSubmissions === 0 ? "complete" : "neutral"}`}
        >
          {completion.label}
        </span>
      </div>
      <div className="monthly-overview">
        <article>
          <small>Avance del equipo</small>
          <strong>{completion.completionPercent}%</strong>
          <div
            className="completion-track"
            aria-label={`${completion.completionPercent}% de evaluaciones completadas`}
          >
            <i style={{ width: `${completion.completionPercent}%` }} />
          </div>
          <span>
            {summary.completedSubmissions} de {summary.expectedSubmissions}{" "}
            evaluaciones esperadas
          </span>
        </article>
        <div className="daily-completion">
          <span className="section-kicker">CUMPLIMIENTO POR DÍA</span>
          {summary.daily.length === 0 ? (
            <p>Aún no existen turnos evaluables en este mes.</p>
          ) : (
            summary.daily.map((day) => {
              const missing =
                day.expectedSubmissions - day.completedSubmissions;
              return (
                <div key={day.serviceDate}>
                  <time>
                    {formatServiceDate(`${day.serviceDate}T12:00:00.000Z`)}
                  </time>
                  <b>
                    {day.completedSubmissions}/{day.expectedSubmissions}
                  </b>
                  <span
                    className={missing === 0 ? "day-complete" : "day-pending"}
                  >
                    {missing === 0
                      ? "Completo"
                      : `${missing} pendiente${missing === 1 ? "" : "s"}`}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
      {evaluatedResults.length > 0 && (
        <div className="result-grid">
          {evaluatedResults.map((result) => (
            <article className="result-card" key={result.membershipId}>
              <header>
                <div className="worker-identity">
                  <span className="avatar">{initials(result.displayName)}</span>
                  <div>
                    <strong>{result.displayName}</strong>
                    <small>{jobTitles[result.jobTitle]}</small>
                  </div>
                </div>
                <div className="score-seal">
                  <strong>
                    {result.score === null ? "—" : result.score.toFixed(2)}
                  </strong>
                  <small>de 5</small>
                </div>
              </header>
              <div className="result-evidence">
                <span>
                  {result.evaluatedDays} día
                  {result.evaluatedDays === 1 ? "" : "s"} evaluado
                  {result.evaluatedDays === 1 ? "" : "s"}
                </span>
                <span>
                  {result.independentRaters} compañero
                  {result.independentRaters === 1 ? "" : "s"}
                </span>
                <span>
                  {result.completedSubmissions} formulario
                  {result.completedSubmissions === 1 ? "" : "s"}
                </span>
                {result.estimatedDays > 0 && (
                  <span className="estimated-evidence">
                    {result.estimatedDays} día
                    {result.estimatedDays === 1 ? "" : "s"} estimado
                    {result.estimatedDays === 1 ? "" : "s"}
                  </span>
                )}
                {result.unscoredDays > 0 && (
                  <span>
                    {result.unscoredDays} día
                    {result.unscoredDays === 1 ? "" : "s"} sin base previa
                  </span>
                )}
              </div>
              <div className="criteria-results">
                {result.criteria.map((criterion) => (
                  <div key={criterion.criterionId}>
                    <span>{criterion.name}</span>
                    <b>
                      {criterion.score === null
                        ? "Sin datos"
                        : criterion.score.toFixed(2)}
                    </b>
                  </div>
                ))}
              </div>
              <footer>
                <span>Decisión sobre propinas</span>
                <strong>Requiere tu aprobación</strong>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EvaluationDesk({
  workspace,
  loading,
  unavailable,
  submitting,
  retry,
  submitEvaluation,
}: {
  workspace: EvaluationWorkspace | null;
  loading: boolean;
  unavailable: boolean;
  submitting: boolean;
  retry(): Promise<void>;
  submitEvaluation(
    event: FormEvent<HTMLFormElement>,
    assignment: EvaluationWorkspace["assignments"][number],
  ): Promise<void>;
}) {
  const state = evaluationWorkspaceState({
    loading,
    unavailable,
    hasWorkspace: Boolean(workspace),
  });
  if (state === "loading")
    return (
      <div className="empty-state" aria-busy="true">
        Buscando tus turnos compartidos…
      </div>
    );
  if (state === "unavailable")
    return (
      <section className="data-section">
        <div className="workspace-retry" role="alert">
          <span>↻</span>
          <div>
            <h2>No pudimos actualizar tu jornada</h2>
            <p>
              Esto es una demora de conexión; no significa que no tengas
              compañeros pendientes.
            </p>
          </div>
          <button className="primary" onClick={() => void retry()}>
            Reintentar ahora
          </button>
        </div>
      </section>
    );
  if (!workspace?.period)
    return (
      <section className="data-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EVALUACIÓN PRIVADA</p>
            <h2>Tu bandeja</h2>
            <span>
              Solo se habilita con un ciclo administrado y turnos reales.
            </span>
          </div>
        </div>
        <Empty
          title="Aún no hay un ciclo abierto"
          text="El administrador debe abrir el ciclo y registrar el primer turno antes de que puedas evaluar."
        />
      </section>
    );
  return (
    <section className="data-section evaluation-page">
      <div className="evaluation-head">
        <div>
          <span className="section-kicker">{workspace.period.name}</span>
          <h2>Evalúa el servicio que compartiste.</h2>
          <p>
            Valora conductas observadas durante ese turno. Tus respuestas quedan
            atribuidas de forma privada y no generan premios ni sanciones
            automáticas.
          </p>
        </div>
        <div>
          <span>PENDIENTES</span>
          <strong>{workspace.assignments.length}</strong>
          <small>Hasta {formatServiceDate(workspace.period.endsAt)}</small>
        </div>
      </div>
      {workspace.assignments.length === 0 ? (
        <Empty
          title="Estás al día"
          text="No tienes compañeros pendientes en turnos compartidos. El jefe de garzones y la cajera no aparecen como personas evaluables por el acuerdo vigente."
        />
      ) : (
        <div className="evaluation-stack">
          {workspace.assignments.map((assignment) => (
            <form
              className="evaluation-card"
              key={`${assignment.shiftId}:${assignment.subjectMembershipId}`}
              onSubmit={(event) => void submitEvaluation(event, assignment)}
            >
              <header>
                <div className="worker-identity">
                  <span className="avatar">
                    {initials(assignment.subjectDisplayName)}
                  </span>
                  <div>
                    <strong>{assignment.subjectDisplayName}</strong>
                    <small>
                      {jobTitles[assignment.subjectJobTitle]} ·{" "}
                      {assignment.section}
                    </small>
                  </div>
                </div>
                <div className="shift-stamp">
                  <span>{formatServiceDate(assignment.startsAt)}</span>
                  <small>
                    {formatServiceTime(assignment.startsAt)}–
                    {formatServiceTime(assignment.endsAt)}
                  </small>
                </div>
              </header>
              <div className="rubric-scale" aria-label="Escala de evaluación">
                <span>
                  <b>1</b>Necesita apoyo
                </span>
                <span>
                  <b>3</b>Cumple
                </span>
                <span>
                  <b>5</b>Destaca
                </span>
              </div>
              <div className="evaluation-criteria">
                {workspace.criteria.map((criterion) => (
                  <StarRating key={criterion.id} criterion={criterion} />
                ))}
              </div>
              <footer>
                <p>
                  Debes valorar al menos dos aspectos observados. Puedes indicar
                  honestamente cuando algo no ocurrió frente a ti.
                </p>
                <button className="primary" disabled={submitting}>
                  Guardar evaluación privada
                </button>
              </footer>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}

const ratingLabels = [
  "Incumplimiento grave o reiterado",
  "Necesita mejorar frecuentemente",
  "Cumple lo esperado",
  "Desempeño muy bueno y constante",
  "Desempeño ejemplar y eleva al equipo",
] as const;

function StarRating({
  criterion,
}: {
  criterion: EvaluationWorkspace["criteria"][number];
}) {
  const [selection, setSelection] = useState("");
  return (
    <fieldset className="star-rating-card">
      <legend>
        <b>{criterion.name}</b>
        <small>{criterion.description}</small>
      </legend>
      <div
        className="star-options"
        role="radiogroup"
        aria-label={`Calificación para ${criterion.name}`}
      >
        {ratingLabels.map((label, index) => {
          const value = index + 1;
          return (
            <label className="rating-star" key={value} title={`${value} · ${label}`}>
              <input
                type="radio"
                name={criterion.id}
                value={value}
                required
                aria-label={`Calificar ${criterion.name} con ${value} estrellas`}
                onChange={() => setSelection(String(value))}
              />
              <span aria-hidden="true">★</span>
              <small>{value}</small>
            </label>
          );
        })}
      </div>
      <div className="rating-anchors" aria-hidden="true">
        <span>1 · Incumplimiento</span>
        <span>3 · Cumple</span>
        <span>5 · Ejemplar</span>
      </div>
      {selection && selection !== "not_observed" && (
        <p className="selected-rating" role="status">
          {selection} · {ratingLabels[Number(selection) - 1]}
        </p>
      )}
      <label className="not-observed-choice">
        <input
          type="radio"
          name={criterion.id}
          value="not_observed"
          onChange={() => setSelection("not_observed")}
        />
        <span>No pude observarlo</span>
      </label>
      {selection === "not_observed" && (
        <label className="observation-note">
          <span>Explica brevemente por qué</span>
          <textarea
            name={`${criterion.id}:note`}
            required
            minLength={8}
            maxLength={240}
            rows={3}
            placeholder="Ej.: No compartimos esa tarea durante este turno."
          />
          <small>No suma ni resta en la calificación.</small>
        </label>
      )}
    </fieldset>
  );
}

function formatServiceDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Santiago",
  }).format(new Date(value));
}
function formatServiceTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Santiago",
  }).format(new Date(value));
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-icon">☆</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TipWorkspace({
  team,
  totalFactor,
  pool,
  setPool,
  simulation,
}: {
  team: TeamMember[];
  totalFactor: number;
  pool: number;
  setPool(value: number): void;
  simulation: Array<{ participantId: string; amountPesos: number }>;
}) {
  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACUERDO REGISTRADO</p>
          <h2>Factores de propina</h2>
          <span>100% equivale a 1,00 punto de experiencia.</span>
        </div>
        <span className="status complete">
          Total {formatExperienceFactor(totalFactor)}
        </span>
      </div>
      <div className="tip-simulator">
        <div className="tip-simulator-head">
          <div>
            <span className="section-kicker">CALCULADORA</span>
            <h3>Distribución del fondo común</h3>
            <p>
              El cálculo no modifica datos ni aplica sanciones automáticamente.
            </p>
          </div>
          <label>
            <span>Fondo común</span>
            <div className="money-input">
              <b>$</b>
              <input
                type="number"
                min="0"
                step="1"
                value={pool}
                onChange={(event) =>
                  setPool(
                    Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                  )
                }
                aria-label="Fondo común de propinas en pesos chilenos"
              />
            </div>
          </label>
        </div>
        {team.length === 0 ? (
          <div className="calculator-empty">
            No hay trabajadores activos para distribuir.
          </div>
        ) : pool === 0 ? (
          <div className="calculator-empty">
            Ingresa el monto real de propinas.
          </div>
        ) : (
          <div className="tip-simulation-grid">
            {team.map((member) => (
              <article key={member.id}>
                <span>{member.displayName}</span>
                <strong>
                  {clpFormatter.format(
                    simulation.find(
                      ({ participantId }) => participantId === member.id,
                    )?.amountPesos ?? 0,
                  )}
                </strong>
                <small>
                  Factor {formatExperienceFactor(member.tipFactorHundredths)}
                </small>
              </article>
            ))}
          </div>
        )}
        {team.length > 0 && (
          <div className="formula-note">
            <strong>Fórmula:</strong> monto ÷{" "}
            {formatExperienceFactor(totalFactor)} × factor individual.
          </div>
        )}
      </div>
    </section>
  );
}
