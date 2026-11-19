/* 経営支援（③）の節目を、保存済みのデータから検出する。
 * 節目の判定はプログラムで行い、助言の文章だけをAIが作る。未保存の変更がある間は節目にしない（保存済みの内容だけで助言する）。 */

import type { CompanionSnapshot } from './companionEngine';

export type Milestone = 'ANALYSIS' | 'GENERATE' | 'CONFIRM';

export const MILESTONE_LABEL: Record<Milestone, string> = {
  ANALYSIS: '分析・論点が保存されました',
  GENERATE: '経営戦略が生成されました',
  CONFIRM: '経営戦略が確定されました',
};

export type MilestoneFingerprints = { issues: string; finalStory: string; bridge: string };

export type MilestoneSignal = { milestone: Milestone; key: string };

/** 内容の指紋（同じ内容なら同じ値）。FNV-1a の32bit。節目の重複防止に使う */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 保存済みの最も進んだ節目を返す。未保存の変更があれば null */
export function detectMilestone(s: CompanionSnapshot, fp: MilestoneFingerprints): MilestoneSignal | null {
  if (!s.ready || s.dirty || !s.companyId || !s.strategyId) return null;
  const base = `${s.companyId}:${s.strategyId}`;
  if (s.stage2Confirmed) return { milestone: 'CONFIRM', key: `MILESTONE:CONFIRM:${base}:${fp.bridge}` };
  if (s.stage2Generated) return { milestone: 'GENERATE', key: `MILESTONE:GENERATE:${base}:${fp.finalStory}` };
  if (s.issueCount > 0) return { milestone: 'ANALYSIS', key: `MILESTONE:ANALYSIS:${base}:${fp.issues}` };
  return null;
}
