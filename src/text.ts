export function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeHandle(value: string): string | null {
  const withoutAt = value.trim().replace(/^@+/, "").toLowerCase();
  if (!withoutAt) {
    return null;
  }
  return withoutAt;
}

export function isHandleSearchKeyword(value?: string): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("@") && Boolean(normalizeHandle(trimmed));
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function textContainsBannedTerm(text: string, bannedTerm: string, bannedTermExceptions: string[] = []): boolean {
  const term = bannedTerm.trim();
  if (!term) {
    return false;
  }
  const searchableText = stripIgnoredBannedWordContexts(text);
  const normalizedExceptions = bannedTermExceptions.map(normalizeSearchText).filter(Boolean);

  if (containsLiteralSyntax(term)) {
    return containsBoundedLiteralTerm(searchableText, term);
  }

  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  return searchableText
    .split(ignoredBannedWordContextBoundary)
    .map(normalizeSearchText)
    .map((normalizedText) => stripBannedTermExceptions(normalizedText, normalizedExceptions))
    .filter(Boolean)
    .some((normalizedText) => ` ${normalizedText} `.includes(` ${normalizedTerm} `));
}

function stripBannedTermExceptions(normalizedText: string, normalizedExceptions: string[]): string {
  let next = normalizedText;
  for (const exception of normalizedExceptions) {
    if (!exception) continue;
    next = ` ${next} `.split(` ${exception} `).join(" ");
  }
  return next.replace(/\s+/g, " ").trim();
}

const ignoredBannedWordContextBoundary = "\u0000";

function stripIgnoredBannedWordContexts(value: string): string {
  const boundary = ` ${ignoredBannedWordContextBoundary} `;
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, boundary)
    .replace(/(^|\s)(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, `$1${boundary}`)
    .replace(/@[A-Za-z0-9_]+/g, boundary);
}

function containsLiteralSyntax(value: string): boolean {
  return /[^a-z0-9\s]/i.test(value);
}

function normalizeLiteralText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsBoundedLiteralTerm(text: string, term: string): boolean {
  const normalizedText = normalizeLiteralText(text);
  const normalizedTerm = normalizeLiteralText(term);
  if (!normalizedText || !normalizedTerm) {
    return false;
  }
  let index = normalizedText.indexOf(normalizedTerm);
  while (index !== -1) {
    const before = index > 0 ? normalizedText[index - 1] : "";
    const after = normalizedText[index + normalizedTerm.length] ?? "";
    if (!isLiteralContinuation(before) && !isLiteralContinuation(after)) {
      return true;
    }
    index = normalizedText.indexOf(normalizedTerm, index + 1);
  }
  return false;
}

function isLiteralContinuation(value: string): boolean {
  return /^[a-z0-9_]$/i.test(value);
}

export function parseLegacyLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let start = 0;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === "\n" || char === "\r") {
      lines.push(content.slice(start, i));
      if (char === "\r" && content[i + 1] === "\n") {
        i += 1;
      }
      start = i + 1;
    }
  }

  if (start < content.length) {
    lines.push(content.slice(start));
  }

  return lines;
}
