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
});

test("explains the monthly cycle and the daily shift before asking for data", () => {
  assert.match(page, /Qué es el ciclo vigente/);
  assert.match(page, /Qué registra este paso diario/);
  assert.match(page, /No es una evaluación/);
  assert.match(page, /Las estrellas aparecerán/);
});

test("does not present six accounts as a maximum or completion target", () => {
  assert.doesNotMatch(page, /de \{onboarding\.target\} cuentas/);
  assert.doesNotMatch(page, /onboarding\.created \/ onboarding\.target/);
});
