// ════════════════════════════════════════════════════════════
//  Entry Point
//  Loads config, creates the bot, handles OS signals.
// ════════════════════════════════════════════════════════════

import { loadConfig }      from './config';
import { CopyTradingBot }  from './bot';
import { log }             from './utils/logger';

async function main(): Promise<void> {
  // ── Load configuration ──────────────────────────────────
  const config = loadConfig();

  // ── Create bot instance ─────────────────────────────────
  const bot = new CopyTradingBot(config);

  // ── Graceful shutdown handlers ──────────────────────────
  const shutdown = async (signal: string) => {
    log.info('Main', `Received ${signal} — initiating shutdown…`);
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    log.error('Main', `Uncaught exception: ${err.message}`);
    log.error('Main', err.stack ?? '');
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log.error('Main', `Unhandled rejection: ${msg}`);
  });

  // ── Start ───────────────────────────────────────────────
  try {
    await bot.start();
  } catch (err) {
    log.error('Main', `Fatal startup error: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── Keep process alive ──────────────────────────────────
  // The bot runs on setInterval timers; we just need to
  // prevent Node from exiting. A long-running unref'd timer:
  const keepAlive = setInterval(() => {
    if (!bot.isRunning()) {
      clearInterval(keepAlive);
      process.exit(0);
    }
  }, 5000);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});