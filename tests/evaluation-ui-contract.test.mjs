import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("uses an accessible five-star control instead of a score select", () => {
  assert.equal(page.includes("<select name={criterion.id}"), false);
  assert.match(page, /role="radiogroup"/);
  assert.match(
    page,
    /aria-label={`Calificar \${criterion\.name} con \${value} estrellas`}/,
  );
  assert.match(page, /className="rating-star"/);
  assert.match(page, /Incumplimiento grave o reiterado/);
  assert.match(page, /Necesita mejorar frecuentemente/);
  assert.match(page, /Cumple lo esperado/);
  assert.match(page, /Desempeño muy bueno y constante/);
  assert.match(page, /Desempeño ejemplar y eleva al equipo/);
  assert.match(page, /No pude observarlo/);
  assert.match(page, /name={`\${criterion\.id}:note`}/);
  assert.match(page, /minLength=\{8\}/);
});

test("distinguishes missing submissions from monthly carry-forward estimates", () => {
  assert.match(page, /Los días sin respuesta siguen pendientes/);
  assert.match(page, /estimación basada solo en días anteriores/);
  assert.match(page, /nunca cuenta como una evaluación enviada/);
  assert.match(page, /result\.estimatedDays > 0/);
  assert.match(page, /Requiere tu aprobación/);
});

test("explains the monthly cycle and the daily shift before asking for data", () => {
  assert.match(page, /Qué es el ciclo vigente/);
  assert.match(page, /Qué registra este paso diario/);
  assert.match(page, /No es una\s+evaluación/);
  assert.match(page, /mediante estrellas/);
  assert.match(page, /MATRIZ OFICIAL/);
  assert.match(page, /6 criterios · misma importancia/);
  assert.match(page, /operations\.criteria\.map/);
  assert.match(page, /El jefe de garzones y la cajera/);
  assert.match(page, /no son evaluados por sus compañeros/);
  assert.match(page, /evalúa, no es evaluado\/a/);
});

test("does not present six accounts as a maximum or completion target", () => {
  assert.doesNotMatch(page, /de \{onboarding\.target\} cuentas/);
  assert.doesNotMatch(page, /onboarding\.created \/ onboarding\.target/);
});

test("makes permanent cycle removal explicit and preserves account expectations", () => {
  assert.match(page, /CONFIRMO ELIMINAR CICLO ANTIGUO/);
  assert.match(page, /No elimina personas/);
  assert.match(page, /La acción queda registrada/);
});

test("hides worker result cards until a real evaluation exists", () => {
  assert.match(page, /result\.completedSubmissions > 0/);
  assert.match(page, /evaluatedResults\.length > 0/);
  assert.match(page, /evaluatedResults\.map/);
});

test("registers one general shift without asking for an area", () => {
  assert.doesNotMatch(page, /name="section"/);
  assert.match(page, /section: "Turno general"/);
  assert.match(page, /defaultChecked/);
  assert.match(page, /Personas que trabajaron juntas/);
  assert.match(page, /Desmarca solamente a quien/);
  assert.match(page, /name="serviceDate"/);
  assert.match(page, /name="startTime"/);
  assert.match(page, /name="endTime"/);
  assert.doesNotMatch(page, /type="datetime-local"/);
  assert.match(page, /reconocerá automáticamente el día siguiente/);
  assert.match(page, /submitShiftDelete/);
  assert.match(page, /Eliminar turno/);
  assert.match(page, /Turno registrado con fechas incorrectas/);
  assert.match(page, /ShiftRegistrationConfirmation/);
  assert.match(page, /Turno registrado correctamente/);
  assert.match(page, /Evaluaciones habilitadas para/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /Cerrar confirmación/);
});

test("provides complete profiles, guarded reset, and kiosk-style interaction controls", () => {
  assert.match(page, /Perfil profesional/);
  assert.match(page, /name="email"/);
  assert.match(page, /name="phone"/);
  assert.match(page, /name="hiredOn"/);
  assert.match(page, /name="bio"/);
  assert.match(page, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(page, /ELIMINAR TODO Y REINICIAR/);
  assert.match(page, /\/api\/admin\/system\/reset/);
  assert.match(page, /addEventListener\("contextmenu", preventContextMenu\)/);
  assert.match(styles, /body \{[^}]*user-select: none/);
  assert.match(styles, /input, textarea, \[contenteditable="true"\][^{]*\{[^}]*user-select: text/);
  assert.match(page, /name="password" type="password" required minLength=\{12\}/);
  assert.match(page, /name="accessKey" type="password" required minLength=\{12\}/);
  assert.match(page, /Clave única de configuración inicial/);
});

test("styles every credential reset form as a complete responsive control", () => {
  assert.match(page, /className="credential-secret"/);
  assert.match(page, /Reemplazar acceso/);
  assert.match(styles, /\.credential-grid \{[^}]*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.credential-card input \{[^}]*width: 100%/);
  assert.match(styles, /\.credential-card input:focus-visible/);
});

test("gives the administrator audited controls over evaluation history", () => {
  assert.match(page, /Historial de evaluaciones/);
  assert.match(page, /ANULAR HISTORIAL/);
  assert.match(page, /Evaluaciones recibidas/);
  assert.match(page, /Evaluaciones realizadas/);
  assert.match(page, /Todo: recibidas y realizadas/);
  assert.match(page, /Anular evaluación/);
  assert.match(page, /Restaurar evaluación/);
  assert.match(page, /No restaurable por acuerdo/);
  assert.match(page, /submitEvaluationModeration/);
  assert.match(page, /submitHistoryDelete/);
});

test("keeps a slow login from remaining indefinitely in a generic saving state", () => {
  assert.match(page, /busyLabel="Ingresando…"/);
  assert.match(page, /LOGIN_SLOW_NOTICE_MS/);
  assert.match(page, /LOGIN_TIMEOUT_MS/);
  assert.match(page, /AUTH_STATUS_TIMEOUT_MS/);
  assert.match(page, /fetchAuthState/);
  assert.match(page, /El servidor está tardando más de lo habitual/);
  assert.match(page, /El acceso tardó demasiado/);
});

test("presents login and administrator recovery in an accessible expanding console", () => {
  assert.match(page, /className={`access-console/);
  assert.match(page, /className="access-console-trigger"/);
  assert.match(page, /aria-expanded={consoleOpen}/);
  assert.match(page, /aria-controls="access-console-content"/);
  assert.match(page, /id="access-console-content"/);
  assert.match(page, /setAccessExpanded\(true\)/);
  assert.match(page, /!compactDesktopLogin/);
  assert.match(page, /useSyncExternalStore/);
  assert.match(page, /className="access-recovery-trigger"/);
  assert.ok(
    page.indexOf('className="access-recovery-trigger"') <
      page.indexOf('className="access-console-body"'),
  );
  assert.match(styles, /\.access-console:hover \.access-console-body/);
  assert.match(styles, /--console-open-duration: 1\.5s/);
  assert.match(styles, /--console-open-delay: \.18s/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.access-console-body \{[\s\S]*?--console-open-duration: 1\.5s/,
  );
  assert.match(
    styles,
    /\.premium-access \.access-form label \{[^}]*caret-color: transparent;[^}]*user-select: none;/,
  );
  assert.match(
    styles,
    /\.premium-access \.access-form input \{[^}]*caret-color: var\(--access-brass\);[^}]*user-select: text;/,
  );
  assert.match(styles, /\.access-console-trigger:hover \.console-lock::before/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /\.access-console \{ width: 100%; max-width: 560px;/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("presents the recovery exit as a clear secondary action", () => {
  assert.match(page, /className="recovery-back-action"/);
  assert.match(page, /className="recovery-back-icon"/);
  assert.match(page, /className="recovery-back-copy"/);
  assert.match(styles, /\.recovery-back-action:hover/);
  assert.match(styles, /\.recovery-back-action:focus-visible/);
});

test("separates the long administrator evaluation page into focused categories", () => {
  assert.match(page, /className="operation-sections"/);
  assert.match(page, /operationSection === "cycle"/);
  assert.match(page, /operationSection === "shifts"/);
  assert.match(page, /operationSection === "history"/);
  assert.match(page, /aria-pressed=/);
});
