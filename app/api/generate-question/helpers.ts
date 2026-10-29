// /app/api/generate-question/helpers.ts

export type Depth = 'board' | 'exec' | 'ops';

/** 章ごとの最大ステップ数 */
export function maxStepsForChapter(chapterIndex: number): number {
  switch (chapterIndex | 0) {
    case 0: return 2;  // 第1章
    case 1: return 6;  // 第2章
    case 2: return 2;  // 第3章
    case 3: return 2;  // 第4章
    default: return 2;
  }
}

/** ステップを 1..max に丸める */
export function clampStepDyn(chapterIndex: number, step: number, min = 1): number {
  const max = maxStepsForChapter(chapterIndex);
  const s = Number.isFinite(step) ? Math.round(step) : min;
  return Math.max(min, Math.min(max, s));
}

/** JSON安全パース（ヒント/事例APIでも利用） */
export function safeParseJson<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try { return m ? (JSON.parse(m[0]) as T) : null; } catch { return null; }
  }
}
