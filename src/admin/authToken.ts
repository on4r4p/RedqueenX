import crypto from "node:crypto";

export type AuthRole = "admin" | "timeline";

export type AuthTokenPayload = {
  sub: string;
  role: AuthRole;
  username: string;
  sessionVersion: string;
  iat: number;
  exp: number;
};

const algorithm = "HS256";
const defaultTtlSeconds = 7 * 24 * 60 * 60;

export function signAuthToken(
  input: { sub: string; role: AuthRole; username: string; sessionVersion: string | number },
  secret: string,
  ttlSeconds = defaultTtlSeconds
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: algorithm, typ: "JWT" };
  const payload: AuthTokenPayload = {
    sub: input.sub,
    role: input.role,
    username: input.username,
    sessionVersion: String(input.sessionVersion),
    iat: now,
    exp: now + ttlSeconds
  };
  const body = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  return `${body}.${sign(body, secret)}`;
}

export function verifyAuthToken(token: string | undefined, secret: string): AuthTokenPayload | null {
  if (!token) {
    return null;
  }
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }

  const body = `${encodedHeader}.${encodedPayload}`;
  if (!timingSafeEqualBase64Url(signature, sign(body, secret))) {
    return null;
  }

  const header = parseBase64UrlJson(encodedHeader);
  if (!header || header.alg !== algorithm || header.typ !== "JWT") {
    return null;
  }

  const payload = parseBase64UrlJson(encodedPayload);
  if (!isAuthTokenPayload(payload)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return null;
  }

  return payload;
}

function sign(value: string, secret: string): string {
  return base64Url(crypto.createHmac("sha256", secret).update(value).digest());
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function parseBase64UrlJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function timingSafeEqualBase64Url(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isAuthTokenPayload(value: Record<string, unknown> | null): value is AuthTokenPayload {
  return Boolean(
    value &&
      typeof value.sub === "string" &&
      typeof value.username === "string" &&
      typeof value.sessionVersion === "string" &&
      (value.role === "admin" || value.role === "timeline") &&
      Number.isInteger(value.iat) &&
      Number.isInteger(value.exp)
  );
}
