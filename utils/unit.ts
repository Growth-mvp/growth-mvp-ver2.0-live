/* ============================================
 * Unit helpers (DISPLAY-ONLY)
 * - Do NOT change persisted values
 * - Normalize for UI display (Million Yen)
 * ============================================ */

const DEBUG =
  typeof window !== 'undefined' &&
  (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1' ||
    localStorage.getItem('__DEBUG_HYDRATE') === '1' ||
    localStorage.getItem('NEXT_PUBLIC_DEBUG_HYDRATE') === '1');

export type MoneyUnitHint = 'yen' | 'millionYen' | 'unknown';

export function safeNumber(x: any): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string') {
    const t = x.trim().replace(/,/g, '');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Convert stored numeric value into "million yen" for DISPLAY.
 * IMPORTANT: This does not mutate storage; caller decides how to interpret the input.
 */
export function toMillionYen(value: any, hint: MoneyUnitHint = 'unknown'): number | null {
  const n = safeNumber(value);
  if (n === null) return null;

  if (hint === 'millionYen') return n;
  if (hint === 'yen') return n / 1_000_000;

  // unknown: do not guess-convert (danger). Just return as-is,
  // but provide scale candidates through inferScaleToMillion for diagnostics.
  return n;
}

/**
 * Provide scale candidates and auto-converted value for Phase 1 normalization.
 *
 * converted: Automatically normalizes to Million Yen based on magnitude:
 * - if Math.abs(raw) >= 1e6: treat as Yen → divide by 1e6
 * - if Math.abs(raw) < 1e6: treat as Million Yen → use as-is
 *
 * Returns possible interpretations to help decide the correct hint.
 * For Phase 1: Use .converted for chart display (ensures Now/Target align).
 */
export function inferScaleToMillion(value: any): { raw: number; candidates: Record<string, number>; converted: number } | null {
  const n = safeNumber(value);
  if (n === null) return null;

  // candidates: interpret raw as yen / million-yen / billion-yen / trillion-yen-ish
  // (common mistakes: ratio,億,百万円,円)
  const candidates: Record<string, number> = {
    asMillionYen_raw: n,
    asYen_toMillion: n / 1_000_000,
    asOkuYen_toMillion: (n * 100_000_000) / 1_000_000, // raw=億円 → 百万円
    asBillionYen_toMillion: (n * 1_000_000_000) / 1_000_000, // raw=十億円 → 百万円
    asTrillionYen_toMillion: (n * 1_000_000_000_000) / 1_000_000, // raw=兆円 → 百万円
    asRatio_toMillion_ifSales1000M: n * 1000, // raw=比率(例0.015)を「売上1000百万円に対する割合」と仮置き（参考）
  };

  // ★ Phase 1: Auto-convert based on magnitude
  // if abs(raw) >= 1e6: likely Yen → convert to Million Yen
  // if abs(raw) < 1e6: likely already Million Yen → use as-is
  const converted = Math.abs(n) >= 1_000_000 ? n / 1_000_000 : n;

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[unit][inferScaleToMillion]', { raw: n, converted, candidates });
  }
  return { raw: n, converted, candidates };
}

export function formatMillion(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '—';
  const v = digits > 0 ? Number(value.toFixed(digits)) : Math.round(value);
  return `${v.toLocaleString()} 百万円`;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** safe divide */
export function safeRatio(numer: number | null, denom: number | null): number | null {
  if (numer === null || denom === null) return null;
  if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom === 0) return null;
  return numer / denom;
}
