// /lib/strategyPatterns.map.ts
import { topPatterns, type TopPatternId } from '@/lib/strategyPatterns.top';
import { execPatterns } from '@/lib/strategyPatterns.exec';
import type { ExecStrategyPattern, WinPatternId } from '@/types/strategy';

/** e系IDをリテラル化（型を安定させる） */
export const EXEC_IDS = [
  'e1',
  'e2',
  'e3',
  'e4',
  'e5',
  'e6',
  'e7',
  'e8',
  'e9',
  'e10',
] as const;

export type ExecPatternId = (typeof EXEC_IDS)[number];

/** t系 → e系の対応（最小ブリッジ） */
export const TOP_TO_EXEC: Record<TopPatternId, ExecPatternId[]> = {
  t1: ['e1', 'e7', 'e10'],
  t2: ['e8', 'e6'],
  t3: ['e4', 'e5', 'e10'],
  t4: ['e3', 'e9', 'e10'],
  t5: ['e8', 'e10'],
  t6: ['e6', 'e10'],
  t7: ['e8', 'e10'],
  t8: ['e6', 'e8', 'e4'],
  t9: ['e9', 'e5'],
  t10: ['e5', 'e10'],
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
  return mapTopToExecIds(topIds)
    .map((id) => execIndex[id])
    .filter(Boolean);
}

/** タイトル辞書（UI表示用） */
export const TOP_TITLES: Record<TopPatternId, string> =
  Object.fromEntries(topPatterns.map((p) => [p.id, p.title])) as Record<
    TopPatternId,
    string
  >;

export const EXEC_TITLES: Record<ExecPatternId, string> =
  Object.fromEntries(
    execPatterns.map((p) => [p.id as ExecPatternId, p.title]),
  ) as Record<ExecPatternId, string>;

/* =========================================================
 * ★追加：Execパターン → 勝ち筋（WinPattern）ブリッジ
 * ---------------------------------------------------------
 * - 既存の Top→Exec マッピングはそのまま維持
 * - WinPatternId（SHORT_REVENUE など）との対応をゆるく定義
 * - STAGE2/3 で「勝ち筋候補」を出す際の参考軸として利用予定
 * ========================================================= */

/** Execパターン → 勝ち筋ID（暫定マッピング）
 *  - SHORT_REVENUE：短期〜中期の売上・収益直結
 *  - COST_FOCUS：コスト削減・選択と集中
 *  - INDIRECT_PEOPLE：人・組織・オンボ・型化
 *  - OPERATION_EFFICIENCY：業務プロセス・生産性
 */
export const EXEC_TO_WIN: Partial<Record<ExecPatternId, WinPatternId>> = {
  e1: 'SHORT_REVENUE',        // 一点突破で売上を取りに行く
  e2: 'SHORT_REVENUE',        // 単価×価値で収益性を上げる
  e3: 'SHORT_REVENUE',        // 既存深耕でLTV改善
  e4: 'SHORT_REVENUE',        // ファネル改善でCVR向上
  e5: 'OPERATION_EFFICIENCY', // 現場の継続改善ループ
  e6: 'SHORT_REVENUE',        // 試供体験で決裁前倒し
  e7: 'COST_FOCUS',           // やらないこと宣言で集中＆コスト意識
  e8: 'SHORT_REVENUE',        // チャネル二刀流で売上拡大
  e9: 'SHORT_REVENUE',        // 原価の物語化で納得単価
  e10: 'INDIRECT_PEOPLE',     // 勝ち筋の標準化・オンボ90点
};

/** t系ID群 → 勝ち筋ID群（重複除去）
 *  - 流れ：TopID[] → ExecID[]（既存ロジック）→ WinPatternId[]
 *  - まだ使われていない場合もあるが、今後 STAGE2/3 で利用予定
 */
export function mapTopToWin(topIds: TopPatternId[]): WinPatternId[] {
  const execIds = mapTopToExecIds(topIds);
  const out: WinPatternId[] = [];
  for (const e of execIds) {
    const w = EXEC_TO_WIN[e];
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}
