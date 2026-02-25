import chalk from "chalk";
import { CONFIG } from "../config";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const currentLevel = LEVELS[CONFIG.LOG_LEVEL] ?? 1;

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

export const log = {
  debug(msg: string, data?: unknown) {
    if (currentLevel <= 0)
      console.log(
        chalk.gray(`[${ts()}] [DBG] ${msg}`),
        data !== undefined ? data : "",
      );
  },

  info(msg: string, data?: unknown) {
    if (currentLevel <= 1)
      console.log(
        chalk.cyan(`[${ts()}] [INF] ${msg}`),
        data !== undefined ? data : "",
      );
  },

  warn(msg: string, data?: unknown) {
    if (currentLevel <= 2)
      console.log(
        chalk.yellow(`[${ts()}] [WRN] ${msg}`),
        data !== undefined ? data : "",
      );
  },

  error(msg: string, data?: unknown) {
    if (currentLevel <= 3)
      console.log(
        chalk.red(`[${ts()}] [ERR] ${msg}`),
        data !== undefined ? data : "",
      );
  },

  trade(msg: string) {
    console.log(chalk.green(`[${ts()}] [TRD] ${msg}`));
  },

  risk(msg: string) {
    console.log(chalk.magenta(`[${ts()}] [RSK] ${msg}`));
  },

  report(line: string) {
    console.log(chalk.white(line));
  },
};
