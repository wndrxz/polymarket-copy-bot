import { CopyEngine } from "./core/copyEngine";
import { log } from "./utils/logger";

async function main(): Promise<void> {
  const engine = new CopyEngine();

  const shutdown = async (signal: string) => {
    log.info(`\nReceived ${signal}`);
    await engine.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception:", err.message);
    log.error(err.stack ?? "");
  });

  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection:", String(reason));
  });

  try {
    await engine.start();
  } catch (err) {
    log.error("Fatal error starting engine:", (err as Error).message);
    process.exit(1);
  }
}

main();
