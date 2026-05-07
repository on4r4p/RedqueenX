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

export function textContainsBannedTerm(text: string, bannedTerm: string): boolean {
  const term = bannedTerm.trim();
  if (!term) {
    return false;
  }
  const searchableText = stripIgnoredBannedWordContexts(text);

  if (containsLiteralSyntax(term)) {
    return normalizeLiteralText(searchableText).includes(normalizeLiteralText(term));
  }

  const normalizedText = normalizeSearchText(searchableText);
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedText || !normalizedTerm) {
    return false;
  }

  return ` ${normalizedText} `.includes(` ${normalizedTerm} `);
}

function stripIgnoredBannedWordContexts(value: string): string {
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/(^|\s)(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, "$1 ")
    .replace(/@[A-Za-z0-9_]+/g, " ");
}

function containsLiteralSyntax(value: string): boolean {
  return /[^a-z0-9\s]/i.test(value);
}

function normalizeLiteralText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
