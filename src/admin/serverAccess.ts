import net from "node:net";

export interface ServerAccessConfig {
  whitelist: string[];
  blacklist: string[];
}

export interface ServerAccessDecision {
  allowed: boolean;
  ip: string | null;
  reason: "allowed" | "blacklisted" | "not_whitelisted" | "not_ipv4";
}

export const DEFAULT_SERVER_ACCESS_CONFIG: ServerAccessConfig = {
  whitelist: ["127.0.0.1"],
  blacklist: []
};

export function mergeServerAccessConfig(...configs: Array<ServerAccessConfig | null | undefined>): ServerAccessConfig {
  return configs.reduce<ServerAccessConfig>(
    (merged, config) => {
      if (!config) {
        return merged;
      }
      return {
        whitelist: normalizeAccessList([...merged.whitelist, ...config.whitelist]),
        blacklist: normalizeAccessList([...merged.blacklist, ...config.blacklist])
      };
    },
    { whitelist: [], blacklist: [] }
  );
}

export function parseAccessListInput(input: string | string[] | undefined): string[] {
  const values = Array.isArray(input) ? input : (input ?? "").split(/[\s,;]+/);
  return normalizeAccessList(values);
}

export function normalizeAccessList(values: string[]): string[] {
  const normalized = values.map((value) => normalizeAccessEntry(value)).filter((value): value is string => Boolean(value));
  return Array.from(new Set(normalized));
}

export function isAccessEntry(value: string): boolean {
  return normalizeAccessEntry(value) !== null;
}

export function isServerAccessAllowed(config: ServerAccessConfig, rawIp: string | undefined): ServerAccessDecision {
  const ip = normalizeClientIpv4(rawIp);
  if (!ip) {
    return { allowed: false, ip: null, reason: "not_ipv4" };
  }

  if (matchesAccessList(ip, config.blacklist)) {
    return { allowed: false, ip, reason: "blacklisted" };
  }

  if (config.whitelist.length > 0 && !matchesAccessList(ip, config.whitelist)) {
    return { allowed: false, ip, reason: "not_whitelisted" };
  }

  return { allowed: true, ip, reason: "allowed" };
}

export function normalizeClientIpv4(rawIp: string | undefined): string | null {
  if (!rawIp) return null;
  const trimmed = rawIp.trim();
  const ipv4Mapped = trimmed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  const candidate = trimmed === "::1" ? "127.0.0.1" : ipv4Mapped?.[1] ?? trimmed;
  return net.isIP(candidate) === 4 ? candidate : null;
}

function normalizeAccessEntry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const [ip, prefix, extra] = trimmed.split("/");
  if (extra !== undefined || net.isIP(ip) !== 4) {
    return null;
  }

  if (prefix === undefined) {
    return ip;
  }

  const prefixNumber = Number(prefix);
  if (!Number.isInteger(prefixNumber) || prefixNumber < 0 || prefixNumber > 32) {
    return null;
  }

  return `${ip}/${prefixNumber}`;
}

function matchesAccessList(ip: string, entries: string[]): boolean {
  return entries.some((entry) => matchesAccessEntry(ip, entry));
}

function matchesAccessEntry(ip: string, entry: string): boolean {
  const [entryIp, prefix] = entry.split("/");
  if (!prefix) {
    return ip === entryIp;
  }

  const bits = Number(prefix);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(ip) & mask) === (ipv4ToNumber(entryIp) & mask);
}

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((value, octet) => ((value << 8) + Number(octet)) >>> 0, 0);
}
