import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "../server/passwords.ts";

test("stores a password as a salted scrypt hash and verifies only the original secret", async () => {
  const encoded = await hashPassword("Una contraseña larga y privada 2026");

  assert.match(encoded, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword("Una contraseña larga y privada 2026", encoded), true);
  assert.equal(await verifyPassword("Otra contraseña", encoded), false);
});

test("uses a unique random salt for every stored password", async () => {
  const first = await hashPassword("Una contraseña larga y privada 2026");
  const second = await hashPassword("Una contraseña larga y privada 2026");

  assert.notEqual(first, second);
});

test("continues to verify legacy PBKDF2 hashes", async () => {
  const legacyHash = "pbkdf2_sha256$600000$AQIDBAUGBwgJCgsMDQ4PEA$q2jEf4IjL-JMRcxnLxn8HWuwjcrXPWetiI3TqWnWRF8";

  assert.equal(await verifyPassword("Contraseña anterior 2026", legacyHash), true);
  assert.equal(await verifyPassword("Contraseña incorrecta", legacyHash), false);
});

test("rejects malformed stored hashes without throwing", async () => {
  assert.equal(await verifyPassword("Una contraseña", "sha256$1$bad"), false);
});
