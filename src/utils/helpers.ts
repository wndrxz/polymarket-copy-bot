import * as crypto from 'crypto';

/** 8-byte random hex string */
export function rid(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** Clamp a number to [min, max] */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Arithmetic mean */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Population standard deviation */
export function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** Sigmoid function mapping ℝ → (0, 1) */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Today as YYYY-MM-DD */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format milliseconds into human-readable duration */
export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Format currency */
export function fmtUsd(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/** Format percentage */
export function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/** Pick random element from array */
export function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Gaussian random via Box-Muller transform */
export function gaussRandom(mean = 0, std = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}