// /lib/patternLinker.ts
import type { PatternBridge } from '@/types/strategy';

/** 上位（t*）→ 下位（e*）の推奨マッピング表
 *  - まずはヒューリスティックな初期値
 *  - 必要に応じてここを編集するだけで全体の提案ロジックが更新されます
 */
export const patternBridge: PatternBridge[] = [
  { topId: 't1',  recommendedExecIds: ['e1', 'e5', 'e7'] }, // 選択と集中 → 一点突破 / 週次改善 / やらないこと
  { topId: 't2',  recommendedExecIds: ['e8', 'e6', 'e9'] }, // グローバル化 → チャネル二刀流 / 試供体験 / 物語化
  { topId: 't3',  recommendedExecIds: ['e4', 'e10', 'e2'] },// デジタル化 → 摩擦除去 / 標準化 / 単価×価値
  { topId: 't4',  recommendedExecIds: ['e3', 'e4', 'e6'] }, // 顧客起点 → 既存深耕 / 摩擦除去 / 試供体験
  { topId: 't5',  recommendedExecIds: ['e8', 'e2', 'e10'] },// プラットフォーム → チャネル / 単価×価値 / 標準化
  { topId: 't6',  recommendedExecIds: ['e9', 'e7', 'e5'] }, // 垂直統合 → 物語化 / やらないこと / 週次改善
  { topId: 't7',  recommendedExecIds: ['e10', 'e5', 'e8'] },// M&A → 標準化 / 週次改善 / チャネル
  { topId: 't8',  recommendedExecIds: ['e9', 'e4', 'e5'] }, // サプライチェーン再設計 → 物語化 / 摩擦除去 / 週次改善
  { topId: 't9',  recommendedExecIds: ['e9', 'e2', 'e6'] }, // 社会×経済価値 → 物語化 / 単価×価値 / 試供体験
  { topId: 't10', recommendedExecIds: ['e7', 'e5', 'e2'] }, // 財務規律 → やらないこと / 週次改善 / 単価×価値
];

/** 選択された上位ID配列から、下位パターン候補（重複除去・最大3件）を返す */
export function linkExecPatterns(selectedTopIds: string[]): string[] {
  const set = new Set<string>();
  selectedTopIds.forEach((tid) => {
    const hit = patternBridge.find((b) => b.topId === tid);
    hit?.recommendedExecIds.forEach((eid) => set.add(eid));
  });
  return Array.from(set).slice(0, 3);
}

/** 上位ID→推奨下位IDs を辞書形式で取得（UIでの表示用など） */
export function getBridgeMap(): Record<string, string[]> {
  return Object.fromEntries(patternBridge.map((b) => [b.topId, b.recommendedExecIds]));
}
