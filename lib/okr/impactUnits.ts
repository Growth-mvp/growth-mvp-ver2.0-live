/* 金額の単位換算。未知の単位は換算せず null を返す（黙って円として扱わない）。 */

const YEN_PER_UNIT: Record<string, number> = {
  円: 1,
  jpy: 1,
  yen: 1,
  '¥': 1,
  千円: 1_000,
  kjpy: 1_000,
  thousand_yen: 1_000,
  万円: 10_000,
  百万円: 1_000_000,
  mjpy: 1_000_000,
  million_yen: 1_000_000,
};

/** 1単位あたりの円。金額単位でなければ null */
export function yenPerUnit(unit: unknown): number | null {
  if (typeof unit !== 'string') return null;
  const key = unit.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(YEN_PER_UNIT, key) ? YEN_PER_UNIT[key] : null;
}

/** 百万円の金額を、目標の単位の数値へ換算する。単位が不明なら null */
export function mjpyToUnit(valueMJPY: number, unit: unknown): number | null {
  const per = yenPerUnit(unit);
  if (per === null || !Number.isFinite(valueMJPY)) return null;
  return (valueMJPY * 1_000_000) / per;
}

/** 目標の単位の数値を円へ換算する。単位が不明なら null */
export function unitToYen(value: unknown, unit: unknown): number | null {
  const per = yenPerUnit(unit);
  if (per === null || typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value * per;
}
