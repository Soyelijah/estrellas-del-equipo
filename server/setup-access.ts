const encoder = new TextEncoder();
const GRANT_LIFETIME_MS = 10 * 60 * 1_000;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function signature(payload: string, secretHash: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secretHash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return encodeBase64Url(new Uint8Array(signed));
}

export async function hashSetupAccessKey(accessKey: string): Promise<string> {
  return sha256(accessKey.normalize("NFKC").trim());
}

export async function verifySetupAccessKey(accessKey: unknown, storedHash: string): Promise<boolean> {
  if (typeof accessKey !== "string" || accessKey.length < 20 || accessKey.length > 200 || !storedHash) return false;
  return constantTimeEqual(await hashSetupAccessKey(accessKey), storedHash);
}

export async function createSetupGrant(secretHash: string, now: string, createNonce: () => string): Promise<string> {
  const expiresAt = new Date(now).getTime() + GRANT_LIFETIME_MS;
  const payload = `${expiresAt}.${createNonce()}`;
  return `${payload}.${await signature(payload, secretHash)}`;
}

export async function verifySetupGrant(grant: unknown, secretHash: string, now: string): Promise<boolean> {
  if (typeof grant !== "string" || grant.length > 512 || !secretHash) return false;
  const parts = grant.split(".");
  if (parts.length !== 3) return false;
  const [expiresAtText, nonce, suppliedSignature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= new Date(now).getTime() || !/^[A-Za-z0-9_-]{8,128}$/u.test(nonce)) return false;
  const payload = `${expiresAtText}.${nonce}`;
  return constantTimeEqual(suppliedSignature, await signature(payload, secretHash));
}

export async function createRecoveryGrant(secretHash: string, now: string, createNonce: () => string): Promise<string> {
  const expiresAt = new Date(now).getTime() + GRANT_LIFETIME_MS;
  const payload = `recovery.${expiresAt}.${createNonce()}`;
  return `${payload}.${await signature(payload, secretHash)}`;
}

export async function verifyRecoveryGrant(grant: unknown, secretHash: string, now: string): Promise<boolean> {
  if (typeof grant !== "string" || grant.length > 512 || !secretHash) return false;
  const parts = grant.split(".");
  if (parts.length !== 4) return false;
  const [scope, expiresAtText, nonce, suppliedSignature] = parts;
  const expiresAt = Number(expiresAtText);
  if (scope !== "recovery" || !Number.isSafeInteger(expiresAt) || expiresAt <= new Date(now).getTime() || !/^[A-Za-z0-9_-]{8,128}$/u.test(nonce)) return false;
  const payload = `${scope}.${expiresAtText}.${nonce}`;
  return constantTimeEqual(suppliedSignature, await signature(payload, secretHash));
}
