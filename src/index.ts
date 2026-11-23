import { createApp } from "./app.js";
import { buildAuth } from "./auth/auth.js";
import { env } from "./config/env.js";
import { closeDatabase, connectDatabase } from "./db/mongo.js";

async function main() {
  const db = await connectDatabase();
  buildAuth(db);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`PizzaHub API listening on http://localhost:${env.PORT}`);
    console.log(`Allowed client origins: ${env.CLIENT_URL}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down PizzaHub API...`);
    server.close(async () => {
      try {
        await closeDatabase();
        process.exit(0);
      } catch (error) {
        console.error("Failed to close the database cleanly:", error);
        process.exit(1);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("PizzaHub API failed to start:", error);
  process.exit(1);
});
