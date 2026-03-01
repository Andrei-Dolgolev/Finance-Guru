import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENCRYPTION_PREFIX = "v1";
const IV_LENGTH = 12; // GCM nonce length

function getKeyMaterial(): string {
  const explicitKey = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  if (explicitKey && explicitKey.trim().length > 0) {
    return explicitKey.trim();
  }

  const plaidSecret = process.env.PLAID_SECRET;
  if (!plaidSecret || plaidSecret.trim().length === 0) {
    throw new Error("PLAID_SECRET (or PLAID_TOKEN_ENCRYPTION_KEY) is required");
  }

  return plaidSecret.trim();
}

function getEncryptionKey(): Buffer {
  // Derive a fixed 256-bit key from configured key material.
  return createHash("sha256").update(getKeyMaterial(), "utf8").digest();
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(":");
}

export function decryptToken(storedValue: string): string {
  // Backward compatibility with legacy plaintext rows.
  if (!storedValue.startsWith(`${ENCRYPTION_PREFIX}:`)) {
    return storedValue;
  }

  const [, ivB64, cipherB64, tagB64] = storedValue.split(":");
  if (!ivB64 || !cipherB64 || !tagB64) {
    throw new Error("Invalid encrypted token format");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64url");
  const ciphertext = Buffer.from(cipherB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  return plaintext;
}
