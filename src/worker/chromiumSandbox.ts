export function shouldDisableChromiumSandbox(
  configured: boolean,
  env: NodeJS.ProcessEnv = process.env,
  uid = process.getuid?.()
): boolean {
  if (!configured) {
    return false;
  }
  return uid === 0 || env.REDQUEENX_CHROMIUM_SANDBOX_UNAVAILABLE === "true";
}
