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

    const resolved = alerts.resolve(alert.id, "Human solved the X challenge from the usual VPN profile.");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedByNote).toContain("Human solved");
    expect(alerts.openForAccount(account.id)).toBeNull();
    expect(() => alerts.openForAccountOrThrow(account)).not.toThrow();
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
