import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecoveryGrant,
  createSetupGrant,
  hashSetupAccessKey,
  verifySetupAccessKey,
  verifyRecoveryGrant,
  verifySetupGrant,
} from "../server/setup-access.ts";

test("verifies a setup access key only against its server-side hash", async () => {
  const storedHash = await hashSetupAccessKey("ESTRELLAS-CLAVE-UNICA-MUY-LARGA-2026");

  assert.equal(await verifySetupAccessKey("ESTRELLAS-CLAVE-UNICA-MUY-LARGA-2026", storedHash), true);
  assert.equal(await verifySetupAccessKey("ESTRELLAS-OTRA-CLAVE-MUY-LARGA-2026", storedHash), false);
  assert.equal(await verifySetupAccessKey("corta", storedHash), false);
});

test("creates a recovery-only grant that cannot be reused as a setup grant", async () => {
  const secretHash = await hashSetupAccessKey("ESTRELLAS-CLAVE-UNICA-MUY-LARGA-2026");
  const grant = await createRecoveryGrant(secretHash, "2026-08-22T12:00:00.000Z", () => "nonce-recuperacion");

  assert.equal(await verifyRecoveryGrant(grant, secretHash, "2026-08-22T12:09:59.000Z"), true);
  assert.equal(await verifySetupGrant(grant, secretHash, "2026-08-22T12:09:59.000Z"), false);
  assert.equal(await verifyRecoveryGrant(`${grant}x`, secretHash, "2026-08-22T12:09:59.000Z"), false);
  assert.equal(await verifyRecoveryGrant(grant, secretHash, "2026-08-22T12:10:01.000Z"), false);
});

test("creates a signed ten-minute setup grant that rejects tampering and expiry", async () => {
  const secretHash = await hashSetupAccessKey("ESTRELLAS-CLAVE-UNICA-MUY-LARGA-2026");
  const grant = await createSetupGrant(secretHash, "2026-08-22T12:00:00.000Z", () => "nonce-seguro");

  assert.equal(await verifySetupGrant(grant, secretHash, "2026-08-22T12:09:59.000Z"), true);
  assert.equal(await verifySetupGrant(`${grant}x`, secretHash, "2026-08-22T12:09:59.000Z"), false);
  assert.equal(await verifySetupGrant(grant, secretHash, "2026-08-22T12:10:01.000Z"), false);
});
