// /lib/strategyPatterns.map.ts
import { topPatterns, type TopPatternId } from '@/lib/strategyPatterns.top';
import { execPatterns } from '@/lib/strategyPatterns.exec';
import type { ExecStrategyPattern } from '@/types/strategy';

/** e系IDをリテラル化（型を安定させる） */
export const EXEC_IDS = [
  'e1','e2','e3','e4','e5','e6','e7','e8','e9','e10',
] as const;
export type ExecPatternId = typeof EXEC_IDS[number];

/** t系 → e系の対応（最小ブリッジ） */
export const TOP_TO_EXEC: Record<TopPatternId, ExecPatternId[]> = {
  t1: ['e1','e7','e10'],
  t2: ['e8','e6'],
  t3: ['e4','e5','e10'],
  t4: ['e3','e9','e10'],
  t5: ['e8','e10'],
  t6: ['e6','e10'],
  t7: ['e8','e10'],
  t8: ['e6','e8','e4'],
  t9: ['e9','e5'],
  t10:['e5','e10'],
};

/** 逆引きインデックス */
const execIndex: Record<ExecPatternId, ExecStrategyPattern> = (() => {
  const idx = {} as Record<ExecPatternId, ExecStrategyPattern>;
  for (const p of execPatterns) {
    const id = p.id as ExecPatternId;
    if (EXEC_IDS.includes(id)) idx[id] = p;
  }
  return idx;
})();

/** t系ID群 → e系ID群（重複除去） */
export function mapTopToExecIds(topIds: TopPatternId[]): ExecPatternId[] {
  const out: ExecPatternId[] = [];
  for (const t of topIds) {
    for (const e of TOP_TO_EXEC[t] || []) {
      if (!out.includes(e)) out.push(e);
    }
  }
  return out;
}

/** t系ID群 → e系パターン配列 */
export function mapTopToExec(topIds: TopPatternId[]): ExecStrategyPattern[] {
  return mapTopToExecIds(topIds).map(id => execIndex[id]).filter(Boolean);
}

/** タイトル辞書（UI表示用） */
export const TOP_TITLES: Record<TopPatternId, string> =
  Object.fromEntries(topPatterns.map(p => [p.id, p.title])) as Record<TopPatternId, string>;

export const EXEC_TITLES: Record<ExecPatternId, string> =
  Object.fromEntries(execPatterns.map(p => [p.id as ExecPatternId, p.title])) as Record<ExecPatternId, string>;
