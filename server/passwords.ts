import { scrypt } from "node:crypto";

const LEGACY_PASSWORD_ITERATIONS = 600_000;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function deriveLegacyPbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const stableSalt = new Uint8Array(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: stableSalt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function deriveScrypt(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      HASH_BYTES,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new Uint8Array(derivedKey));
      },
    );
  });
}

function matchesExpected(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveScrypt(password, salt);
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${encodeBase64Url(salt)}$${encodeBase64Url(hash)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split("$");

    if (
      parts.length === 6 &&
      parts[0] === "scrypt" &&
      parts[1] === String(SCRYPT_COST) &&
      parts[2] === String(SCRYPT_BLOCK_SIZE) &&
      parts[3] === String(SCRYPT_PARALLELIZATION)
    ) {
      const salt = decodeBase64Url(parts[4] ?? "");
      const expected = decodeBase64Url(parts[5] ?? "");
      if (!salt || salt.length !== SALT_BYTES || !expected || expected.length !== HASH_BYTES) return false;
      return matchesExpected(await deriveScrypt(password, salt), expected);
    }

    if (parts.length === 4 && parts[0] === "pbkdf2_sha256" && parts[1] === String(LEGACY_PASSWORD_ITERATIONS)) {
      const salt = decodeBase64Url(parts[2] ?? "");
      const expected = decodeBase64Url(parts[3] ?? "");
      if (!salt || salt.length !== SALT_BYTES || !expected || expected.length !== HASH_BYTES) return false;
      return matchesExpected(await deriveLegacyPbkdf2(password, salt, LEGACY_PASSWORD_ITERATIONS), expected);
    }

    return false;
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return encodeBase64Url(new Uint8Array(digest));
}
