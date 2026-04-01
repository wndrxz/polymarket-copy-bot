// ════════════════════════════════════════════════════════════
// State Persistence
// Atomic JSON file read/write with versioning.
// Serialises Maps ↔ entry arrays for JSON compatibility.
// ════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import type { BotState, Portfolio, Position, TraderStats } from '../core/types';
import { log } from '../utils/logger';

const STATE_DIR  = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const CURRENT_VERSION = 1;

export class StateStore {
  /** Save full bot state to disk (atomic write via rename) */
  save(
    portfolio: Portfolio,
    traders: Map<string, TraderStats>,
    marketPrices: Map<string, Record<string, number>>,
  ): void {
    try {
      if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
      }

      const state: BotState = {
        version: CURRENT_VERSION,
        savedAt: Date.now(),
        portfolio: {
          balance: portfolio.balance,
          startingBalance: portfolio.startingBalance,
          peakEquity: portfolio.peakEquity,
          positions: [...portfolio.positions.entries()],
          orders: portfolio.orders,
          trades: portfolio.trades,
          dailyPnl: [...portfolio.dailyPnl.entries()],
        },
        traders: [...traders.entries()],
        marketPrices: [...marketPrices.entries()],
      };

      const json = JSON.stringify(state, null, 2);

      // Atomic write: write temp file, then rename
      const tmpFile = STATE_FILE + '.tmp';
      fs.writeFileSync(tmpFile, json, 'utf-8');
      fs.renameSync(tmpFile, STATE_FILE);

      log.debug('Persist', `State saved (${(json.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      log.error('Persist', `Failed to save state: ${(err as Error).message}`);
    }
  }

  /** Load state from disk. Returns null if no state file exists. */
  load(): BotState | null {
    try {
      if (!fs.existsSync(STATE_FILE)) {
        log.info('Persist', 'No saved state found — starting fresh');
        return null;
      }

      const json = fs.readFileSync(STATE_FILE, 'utf-8');
      const state: BotState = JSON.parse(json);

      if (state.version !== CURRENT_VERSION) {
        log.warn('Persist', `State version mismatch (file: ${state.version}, expected: ${CURRENT_VERSION}) — starting fresh`);
        return null;
      }

      const age = Date.now() - state.savedAt;
      log.info('Persist', `Restored state from ${new Date(state.savedAt).toISOString()} (${Math.round(age / 60_000)}m ago)`);
      log.info('Persist', `  Balance: $${state.portfolio.balance.toFixed(2)}, Positions: ${state.portfolio.positions.length}, Trades: ${state.portfolio.trades.length}`);

      return state;
    } catch (err) {
      log.error('Persist', `Failed to load state: ${(err as Error).message}`);
      return null;
    }
  }

  /** Delete saved state */
  clear(): void {
    try {
      if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
        log.info('Persist', 'State file deleted');
      }
    } catch (err) {
      log.error('Persist', `Failed to delete state: ${(err as Error).message}`);
    }
  }

  /** Check if state file exists */
  exists(): boolean {
    return fs.existsSync(STATE_FILE);
  }
}