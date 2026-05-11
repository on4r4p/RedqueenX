import type { Database } from "better-sqlite3";
import type { XBrowserAccountRecord } from "./xBrowserAccountService";

export type XSessionAlertType =
  | "captcha"
  | "two_factor"
  | "challenge"
  | "login_expired"
  | "x_blocked"
  | "manual_verification"
  | "unknown_auth_problem";

export type XSessionAlertStatus = "open" | "resolved" | "ignored";

export interface XSessionAlertRecord {
  id: number;
  accountId: number;
  xIdentifier: string;
  vpnProfilePath: string;
  publicIpv4: string | null;
  alertType: XSessionAlertType;
  message: string;
  recommendation: string;
  details: Record<string, unknown>;
  status: XSessionAlertStatus;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedByNote: string | null;
}

export interface CreateXSessionAlertInput {
  accountId: number;
  xIdentifier: string;
  vpnProfilePath: string;
  publicIpv4?: string | null;
  alertType: XSessionAlertType;
  message?: string;
  recommendation?: string;
  details?: Record<string, unknown>;
}

type XSessionAlertRow = {
  id: number;
  account_id: number;
  x_identifier: string;
  vpn_profile_path: string;
  public_ipv4: string | null;
  alert_type: XSessionAlertType;
  message: string;
  recommendation: string;
  details_json: string;
  status: XSessionAlertStatus;
  detected_at: string;
  resolved_at: string | null;
  resolved_by_note: string | null;
};

export class XSessionAlertOpenError extends Error {
  constructor(readonly alert: XSessionAlertRecord) {
    super(
      [
        "X account is locked by an open manual verification alert.",
        `Account: ${alert.xIdentifier}.`,
        `VPN profile: ${alert.vpnProfilePath}.`,
        "Resolve the alert in Admin > X Session Alert after the human has manually fixed the X challenge from the usual IP/VPN profile."
      ].join(" ")
    );
    this.name = "XSessionAlertOpenError";
  }
}

export class XSessionAlertService {
  constructor(private readonly database: Database) {}

  createOpen(input: CreateXSessionAlertInput): XSessionAlertRecord {
    const existing = this.openForAccount(input.accountId);
    if (existing) {
      return this.refreshOpen(existing.id, input);
    }

    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `
          INSERT INTO x_session_alerts (
            account_id,
            x_identifier,
            vpn_profile_path,
            public_ipv4,
            alert_type,
            message,
            recommendation,
            details_json,
            status,
            detected_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
          RETURNING *
        `
      )
      .get(
        input.accountId,
        input.xIdentifier,
        input.vpnProfilePath,
        input.publicIpv4 ?? null,
        input.alertType,
        input.message ?? defaultManualVerificationMessage(),
        input.recommendation ?? defaultManualVerificationRecommendation(input.accountId),
        JSON.stringify(input.details ?? {}),
        now
      ) as XSessionAlertRow;

    return mapRow(row);
  }

  private refreshOpen(id: number, input: CreateXSessionAlertInput): XSessionAlertRecord {
    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `
          UPDATE x_session_alerts
          SET x_identifier = ?,
              vpn_profile_path = ?,
              public_ipv4 = ?,
              alert_type = ?,
              message = ?,
              recommendation = ?,
              details_json = ?,
              detected_at = ?
          WHERE id = ?
            AND status = 'open'
          RETURNING *
        `
      )
      .get(
        input.xIdentifier,
        input.vpnProfilePath,
        input.publicIpv4 ?? null,
        input.alertType,
        input.message ?? defaultManualVerificationMessage(),
        input.recommendation ?? defaultManualVerificationRecommendation(input.accountId),
        JSON.stringify(input.details ?? {}),
        now,
        id
      ) as XSessionAlertRow | undefined;
    if (!row) {
      throw new Error(`Open X session alert not found: ${id}`);
    }
    return mapRow(row);
  }

  openForAccount(accountId: number): XSessionAlertRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM x_session_alerts
          WHERE account_id = ?
            AND status = 'open'
          ORDER BY detected_at DESC, id DESC
          LIMIT 1
        `
      )
      .get(accountId) as XSessionAlertRow | undefined;
    return row ? mapRow(row) : null;
  }

  find(id: number): XSessionAlertRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM x_session_alerts
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(id) as XSessionAlertRow | undefined;
    return row ? mapRow(row) : null;
  }

  openForAccountOrThrow(account: XBrowserAccountRecord): void {
    const alert = this.openForAccount(account.id);
    if (alert) {
      throw new XSessionAlertOpenError(alert);
    }
  }

  openAlerts(): XSessionAlertRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM x_session_alerts
          WHERE status = 'open'
          ORDER BY detected_at DESC, id DESC
        `
      )
      .all() as XSessionAlertRow[];
    return rows.map(mapRow);
  }

  recent(limit = 20): XSessionAlertRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM x_session_alerts
          ORDER BY detected_at DESC, id DESC
          LIMIT ?
        `
      )
      .all(safeLimit) as XSessionAlertRow[];
    return rows.map(mapRow);
  }

  resolve(id: number, note: string): XSessionAlertRecord {
    return this.close(id, "resolved", note, "A resolution note is required before unlocking this X account.");
  }

  ignore(id: number): XSessionAlertRecord {
    return this.close(id, "ignored", "Ignored from admin without saving a fresh X browser session.");
  }

  private close(id: number, status: "resolved" | "ignored", note: string, emptyNoteMessage = "A note is required."): XSessionAlertRecord {
    const trimmedNote = note.trim();
    if (trimmedNote.length < 1) {
      throw new Error(emptyNoteMessage);
    }
    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `
          UPDATE x_session_alerts
          SET status = ?,
              resolved_at = ?,
              resolved_by_note = ?
          WHERE id = ?
            AND status = 'open'
          RETURNING *
        `
      )
      .get(status, now, trimmedNote, id) as XSessionAlertRow | undefined;
    if (!row) {
      throw new Error(`Open X session alert not found: ${id}`);
    }
    return mapRow(row);
  }
}

export function defaultManualVerificationMessage(): string {
  return "RedqueenX stopped because X requested a manual verification.";
}

export function defaultManualVerificationRecommendation(accountId: number): string {
  return [
    "No more scraping or login will run for this X account until this alert is resolved.",
    "Log in manually from the usual IP/VPN profile used by this X account.",
    "Let the human solve CAPTCHA/2FA/challenge manually.",
    "The visible login flow saves a fresh browser session automatically as soon as login is detected.",
    "Return here after the session is saved, then mark the alert as resolved with a note.",
    `Recommended local commands: npm run setup:local; npm run netns:x-login -- --account-id ${accountId} --resolve-alert --auto-save-on-login --hold-open-after-save; npm run netns:diagnose; npm run netns:worker.`
  ].join(" ");
}

function mapRow(row: XSessionAlertRow): XSessionAlertRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    xIdentifier: row.x_identifier,
    vpnProfilePath: row.vpn_profile_path,
    publicIpv4: row.public_ipv4,
    alertType: row.alert_type,
    message: row.message,
    recommendation: row.recommendation,
    details: parseDetails(row.details_json),
    status: row.status,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    resolvedByNote: row.resolved_by_note
  };
}

function parseDetails(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
