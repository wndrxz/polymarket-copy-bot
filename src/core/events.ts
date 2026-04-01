import { EventEmitter } from 'events';
import type {
  Signal,
  Order,
  Position,
  Trade,
  RiskVerdict,
  PerformanceReport,
} from './types';

/**
 * Typed event map — every event the bot can emit.
 */
export interface BotEventMap {
  'signal:received':    [Signal];
  'risk:approved':      [Signal, RiskVerdict];
  'risk:rejected':      [Signal, RiskVerdict];
  'order:filled':       [Order];
  'order:rejected':     [Order];
  'position:opened':    [Position];
  'position:updated':   [Position];
  'position:closed':    [Position, Trade];
  'position:stoploss':  [Position, Trade];
  'position:takeprofit':[Position, Trade];
  'report:generated':   [PerformanceReport];
  'state:saved':        [];
  'bot:started':        [];
  'bot:stopped':        [];
  'error':              [Error];
}

/**
 * EventEmitter with full type safety for all bot events.
 */
export class BotEmitter extends EventEmitter {
  override emit<K extends keyof BotEventMap>(
    event: K,
    ...args: BotEventMap[K]
  ): boolean {
    return super.emit(event as string, ...args);
  }

  override on<K extends keyof BotEventMap>(
    event: K,
    listener: (...args: BotEventMap[K]) => void,
  ): this {
    return super.on(event as string, listener as (...a: unknown[]) => void);
  }

  override once<K extends keyof BotEventMap>(
    event: K,
    listener: (...args: BotEventMap[K]) => void,
  ): this {
    return super.once(event as string, listener as (...a: unknown[]) => void);
  }
}