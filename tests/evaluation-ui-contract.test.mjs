import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

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
});
