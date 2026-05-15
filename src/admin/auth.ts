import crypto from "node:crypto";
import argon2 from "argon2";

const HASH_PREFIX = "pbkdf2-sha256";
const DEFAULT_ITERATIONS = 210_000;
const KEY_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export function hashPasswordLegacy(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const derived = crypto.pbkdf2Sync(password, salt, DEFAULT_ITERATIONS, KEY_LENGTH, "sha256").toString("hex");
  return `${HASH_PREFIX}:${DEFAULT_ITERATIONS}:${salt}:${derived}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (passwordHash.startsWith("$argon2")) {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }
  return verifyLegacyPassword(password, passwordHash);
}

export async function verifyAdminPassword(
  password: string,
  options: { password?: string; passwordHash?: string }
): Promise<boolean> {
  if (options.passwordHash) {
    return verifyPassword(password, options.passwordHash);
  }
  if (options.password) {
    const actual = Buffer.from(password);
    const expected = Buffer.from(options.password);
    if (actual.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(actual, expected);
  }
  return false;
}

function verifyLegacyPassword(password: string, passwordHash: string): boolean {
  const [prefix, iterationsRaw, salt, expected] = passwordHash.split(":");
  if (prefix !== HASH_PREFIX || !iterationsRaw || !salt || !expected) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const actual = crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha256").toString("hex");
  return timingSafeEqualHex(actual, expected);
}

function timingSafeEqualHex(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
