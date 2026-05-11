import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type VpnIsolationRuntime = {
  searchWithoutApiIsolation: "host_netns" | "docker_vpn";
  vpnNetnsName: string;
};

export async function assertVpnRuntime(config: VpnIsolationRuntime, purpose: string): Promise<void> {
  if (config.searchWithoutApiIsolation === "docker_vpn") {
    await assertDockerVpnRuntime(purpose);
    return;
  }
  await assertVpnNamespaceRuntime(config.vpnNetnsName, purpose);
}

export async function assertVpnNamespaceRuntime(netnsName: string, purpose: string): Promise<void> {
  const marker = process.env.REDQUEENX_VPN_NETNS;
  if (marker !== netnsName) {
    throw new Error(
      [
        `${purpose} must run inside the configured VPN namespace before any browser action starts.`,
        `Expected REDQUEENX_VPN_NETNS=${netnsName}, got ${marker || "unset"}.`,
        "Launch it through npm run netns:x-login or npm run netns:worker, not through the direct x:login/worker scripts."
      ].join(" ")
    );
  }

  await assertTunRoute(purpose);
}

async function assertDockerVpnRuntime(purpose: string): Promise<void> {
  if (process.env.REDQUEENX_DOCKER_VPN !== "true") {
    throw new Error(
      [
        `${purpose} must run inside the Docker VPN network before any browser action starts.`,
        `Expected REDQUEENX_DOCKER_VPN=true, got ${process.env.REDQUEENX_DOCKER_VPN || "unset"}.`,
        "Launch it through docker compose up -d worker or docker compose run --rm x-login, not through direct worker scripts."
      ].join(" ")
    );
  }

  await assertTunRoute(purpose);
}

async function assertTunRoute(purpose: string): Promise<void> {
  const links = await execIp(["-o", "link", "show"]);
  if (!/^\d+:\s+tun[^:]*:/m.test(links)) {
    throw new Error(`${purpose} refused to start: no tun+ interface is visible in the current network namespace.`);
  }

  const route = await execIp(["route", "get", "1.1.1.1"]);
  if (!/\bdev\s+tun[^\s]*/.test(route)) {
    throw new Error(
      `${purpose} refused to start: traffic to the Internet is not routed through tun+. Route check: ${singleLine(route)}`
    );
  }
}

async function execIp(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("ip", args, {
    timeout: 5_000,
    maxBuffer: 200_000
  });
  return stdout;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
