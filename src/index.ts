import "dotenv/config";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { createAdminApi } from "./admin/api";
import { restartSignalPath } from "./restart-signal";

async function main() {
  const config = loadConfig();
  if (config.adminAuthMode === "password" && !config.adminPassword && !config.adminPasswordHash) {
    throw new Error("ADMIN_PASSWORD or ADMIN_PASSWORD_HASH must be set before starting the admin API.");
  }

  const database = openDatabase(config.databaseUrl);
  const app = createAdminApi({ database, config, logger: true, restartSignalPath });

  await app.listen({
    host: config.adminHost,
    port: config.adminPort
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
