import { ApiResponseError } from "twitter-api-v2";

export function looksLikeXApiCreditsDepleted(error: unknown): boolean {
  const code = xApiErrorCode(error);
  const text = xApiErrorSearchText(error);
  return code === "402" || /credits?\s*depleted|creditsdepleted|credit[^a-z0-9]+depleted/i.test(text);
}

export function xApiCreditsDepletedMessage(): string {
  return "X API credits depleted (HTTP 402). Remaining API credit USD was set to 0 in X API settings.";
}

export function xApiErrorCode(error: unknown): string | null {
  const code = numericErrorProperty(error, "code") ?? numericErrorProperty(error, "status") ?? numericErrorProperty(error, "statusCode");
  if (code !== null) {
    return code;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/\b(?:code|status|http)\s*:?\s*(\d{3})\b/i)?.[1] ?? null;
}

function numericErrorProperty(error: unknown, key: "code" | "status" | "statusCode"): string | null {
  if (!(typeof error === "object" && error !== null)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^\d{3}$/.test(value)) {
    return value;
  }
  return null;
}

function xApiErrorSearchText(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
  } else {
    parts.push(String(error));
  }
  if (error instanceof ApiResponseError) {
    parts.push(String(error.code));
  }
  if (typeof error === "object" && error !== null) {
    for (const key of ["data", "error", "errors", "rateLimit", "headers", "type", "title", "detail"]) {
      const value = (error as Record<string, unknown>)[key];
      if (value !== undefined) {
        parts.push(safeStringify(value));
      }
    }
  }
  return parts.filter(Boolean).join(" ");
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
