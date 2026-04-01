// ════════════════════════════════════════════════════════════
// Zero-dependency structured logger with ANSI colours
// ════════════════════════════════════════════════════════════

const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  blue:     '\x1b[34m',
  magenta:  '\x1b[35m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  bgRed:    '\x1b[41m',
  bgGreen:  '\x1b[42m',
  bgYellow: '\x1b[43m',
};

enum Level { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 }

const LEVEL_LABEL: Record<Level, string> = {
  [Level.DEBUG]: `${C.dim}DBG${C.reset}`,
  [Level.INFO]:  `${C.cyan}INF${C.reset}`,
  [Level.WARN]:  `${C.yellow}WRN${C.reset}`,
  [Level.ERROR]: `${C.red}ERR${C.reset}`,
};

class Logger {
  private level: Level;

  constructor(level: string = 'INFO') {
    this.level = Level[level as keyof typeof Level] ?? Level.INFO;
  }

  private log(lvl: Level, tag: string, msg: string, meta?: unknown): void {
    if (lvl < this.level) return;
    const ts = new Date().toISOString().slice(11, 23);
    const prefix = `${C.dim}${ts}${C.reset} ${LEVEL_LABEL[lvl]} ${C.bold}[${tag}]${C.reset}`;
    const line = meta !== undefined
      ? `${prefix} ${msg} ${C.dim}${JSON.stringify(meta)}${C.reset}`
      : `${prefix} ${msg}`;
    console.log(line);
  }

  debug(tag: string, msg: string, meta?: unknown) { this.log(Level.DEBUG, tag, msg, meta); }
  info(tag: string, msg: string, meta?: unknown)  { this.log(Level.INFO, tag, msg, meta); }
  warn(tag: string, msg: string, meta?: unknown)  { this.log(Level.WARN, tag, msg, meta); }
  error(tag: string, msg: string, meta?: unknown) { this.log(Level.ERROR, tag, msg, meta); }

  /** Green-highlighted trade execution log */
  trade(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`${C.dim}${ts}${C.reset} ${C.bgGreen}${C.bold} TRADE ${C.reset} ${msg}`);
  }

  /** Risk decision log */
  risk(approved: boolean, msg: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    const badge = approved
      ? `${C.bgGreen}${C.bold} PASS ${C.reset}`
      : `${C.bgRed}${C.bold} DENY ${C.reset}`;
    console.log(`${C.dim}${ts}${C.reset} ${badge} ${msg}`);
  }

  /** Section divider */
  divider(title?: string): void {
    if (title) {
      console.log(`\n${C.cyan}${'─'.repeat(20)} ${title} ${'─'.repeat(40 - title.length)}${C.reset}`);
    } else {
      console.log(`${C.dim}${'─'.repeat(64)}${C.reset}`);
    }
  }
}

export const log = new Logger(process.env.LOG_LEVEL || 'INFO');