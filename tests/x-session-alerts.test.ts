import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CurrentSessionService } from "../src/admin/currentSessionService";
import { XBrowserAccountService } from "../src/admin/xBrowserAccountService";
import { XSessionAlertOpenError, XSessionAlertService } from "../src/admin/xSessionAlertService";
import { openMemoryDatabase } from "../src/db/database";

describe("x session alerts", () => {
  it("locks an X browser account until a note-backed resolution is saved", () => {
    const database = openMemoryDatabase();
    const accounts = new XBrowserAccountService(database);
    const alerts = new XSessionAlertService(database);
    const account = accounts.upsert({
      vpnProfilePath: "./ops/vpn/locked.ovpn",
      xIdentifier: "@locked_account"
    });

    const alert = alerts.createOpen({
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      vpnProfilePath: account.vpnProfilePath,
      publicIpv4: "203.0.113.10",
      alertType: "challenge",
      details: {
        url: "https://x.com/search?q=test",
        title: "Something went wrong / X",
        reason: "X returned a blocking error page.",
        visibleText: "Something went wrong. Try reloading.",
        htmlSnippet: "<main>Something went wrong</main>",
        snapshotPath: "./runtime/x-session-alert-snapshots/example.json"
      }
    });

    expect(alert.status).toBe("open");
    expect(alert.details).toMatchObject({
      url: "https://x.com/search?q=test",
      title: "Something went wrong / X",
      snapshotPath: "./runtime/x-session-alert-snapshots/example.json"
    });
    expect(() => alerts.openForAccountOrThrow(account)).toThrow(XSessionAlertOpenError);
    expect(() => alerts.resolve(alert.id, "")).toThrow(/resolution note/i);

    const resolved = alerts.resolve(alert.id, "ok");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedByNote).toBe("ok");
    expect(alerts.openForAccount(account.id)).toBeNull();
    expect(() => alerts.openForAccountOrThrow(account)).not.toThrow();

    const ignoredAlert = alerts.createOpen({
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      vpnProfilePath: account.vpnProfilePath,
      publicIpv4: "203.0.113.10",
      alertType: "x_blocked"
    });
    const ignored = alerts.ignore(ignoredAlert.id);
    expect(ignored.status).toBe("ignored");
    expect(ignored.resolvedByNote).toContain("Ignored from admin");
    expect(alerts.openForAccount(account.id)).toBeNull();
  });

  it("refreshes evidence when an account already has an open X session alert", () => {
    const database = openMemoryDatabase();
    const accounts = new XBrowserAccountService(database);
    const alerts = new XSessionAlertService(database);
    const account = accounts.upsert({
      vpnProfilePath: "./ops/vpn/locked.ovpn",
      xIdentifier: "@locked_account"
    });

    const first = alerts.createOpen({
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      vpnProfilePath: account.vpnProfilePath,
      publicIpv4: "203.0.113.10",
      alertType: "two_factor",
      details: { snapshotPath: "./runtime/x-session-alert-snapshots/old.json", visibleText: "" }
    });
    const second = alerts.createOpen({
      accountId: account.id,
      xIdentifier: account.xIdentifier,
      vpnProfilePath: account.vpnProfilePath,
      publicIpv4: "203.0.113.11",
      alertType: "x_blocked",
      details: {
        snapshotPath: "./runtime/x-session-alert-snapshots/new.json",
        visibleText: "Something went wrong. Try reloading.",
        bodyTextLength: 38
      }
    });

    expect(second.id).toBe(first.id);
    expect(second.alertType).toBe("x_blocked");
    expect(second.publicIpv4).toBe("203.0.113.11");
    expect(second.details).toMatchObject({
      snapshotPath: "./runtime/x-session-alert-snapshots/new.json",
      visibleText: "Something went wrong. Try reloading.",
      bodyTextLength: 38
    });
    expect(alerts.openAlerts()).toHaveLength(1);
  });

  it("formats manual verification alerts as a readable current session block", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "redqueen-session-alert-"));
    const filePath = path.join(tmp, "current-session.log");
    const session = new CurrentSessionService(filePath);

    await session.record("prob", "x.manual_verification.required", "X manual verification required; browser worker stopped", {
      accountId: 7,
      xIdentifier: "@locked_account",
      vpnProfilePath: "./ops/vpn/locked.ovpn",
      publicIpv4: "203.0.113.10",
      alertType: "captcha",
      message: "RedqueenX stopped because X requested a manual verification.",
      recommendation: "Log in manually from the usual IP/VPN profile used by this X account.",
      details: {
        url: "https://x.com/search?q=test",
        title: "Something went wrong / X",
        reason: "X returned a blocking error page.",
        snapshotPath: "./runtime/x-session-alert-snapshots/example.json",
        detectionSignals: ["Visible page text matched 'Something went wrong' or 'Try reloading'."],
        visibleTextPreview: "Something went wrong. Try reloading."
      }
    });

    const snapshot = await session.read(20, "prob");
    const text = snapshot.lines.join("\n");
    expect(text).toContain("X MANUAL VERIFICATION REQUIRED");
    expect(text).toContain("@locked_account");
    expect(text).toContain("./ops/vpn/locked.ovpn");
    expect(text).toContain("203.0.113.10");
    expect(text).toContain("https://x.com/search?q=test");
    expect(text).toContain("Something went wrong / X");
    expect(text).toContain("./runtime/x-session-alert-snapshots/example.json");
    expect(text).toContain("Detection signals:");
    expect(text).toContain("Something went wrong");
    expect(text).not.toContain("Visible text preview");
    expect(text).not.toContain("\nSomething went wrong. Try reloading.");
    expect(text).toContain("npm run netns:x-login -- --account-id 7");
  });
});
