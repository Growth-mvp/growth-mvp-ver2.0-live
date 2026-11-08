import type { AssumptionBasisKind, AssumptionProvenance, ProjectDraftReasoning } from '@/types/strategy';
import { sanitizeDraftReasoning } from './draftPromptSections';

export const ASSUMPTION_LABEL: Record<string, string> = {
  targetCustomers: '対象顧客数（社）',
  conversionRatePct: '想定受注率（%）',
  averageDealMJPY: '平均単価（百万円）',
  currentCostMJPY: '現在コスト（百万円）',
  reductionRatePct: '削減率（%）',
  peopleCount: '投入人数（人）',
  durationMonths: '実施月数（月）',
  monthlyCostPerPersonMJPY: '1人あたり月額（百万円）',
  externalCostMJPY: '外部費用（百万円）',
};

/** AIが「実績」と書いても、検証できないため仮説として扱う */
const AI_ALLOWED: AssumptionBasisKind[] = ['DERIVED', 'HYPOTHESIS', 'MISSING', 'PRESET'];

function aiBasisOf(raw: unknown): AssumptionBasisKind {
  return typeof raw === 'string' && (AI_ALLOWED as string[]).includes(raw) && raw !== 'MISSING' ? (raw as AssumptionBasisKind) : 'HYPOTHESIS';
}

/** AIの生成結果から、保存する根拠を作る（前提の値は AIの仮説＝AI_DRAFT 出所） */
export function reasoningFromDraft(draft: any, assumptionKeys: string[]): ProjectDraftReasoning {
  const checked = sanitizeDraftReasoning(draft);
  const provenance: Record<string, AssumptionProvenance> = {};
  for (const key of assumptionKeys) {
    provenance[key] = { source: 'AI_DRAFT', basis: aiBasisOf(checked.assumptionBasis?.[key]) };
  }
  const out: ProjectDraftReasoning = { verificationItems: checked.verificationItems, provenance };
  if (checked.causalChain) out.causalChain = checked.causalChain;
  return out;
}

/** 利用者が数値を修正した：元の出所は残し、修正した事実を記録する */
export function provenanceAfterEdit(prev: Record<string, AssumptionProvenance> | undefined, changedKeys: string[]): Record<string, AssumptionProvenance> {
  const next: Record<string, AssumptionProvenance> = { ...(prev ?? {}) };
  for (const key of changedKeys) {
    const before = next[key];
    next[key] = before
      ? { ...before, userEdited: true }
      : { source: 'USER_INPUT', basis: 'USER_DATA', userEdited: true };
  }
  return next;
}

/** 固定プリセットを選んだ */
export function provenanceAfterPreset(prev: Record<string, AssumptionProvenance> | undefined, keys: string[]): Record<string, AssumptionProvenance> {
  const next: Record<string, AssumptionProvenance> = { ...(prev ?? {}) };
  for (const key of keys) next[key] = { source: 'PRESET', basis: 'PRESET' };
  return next;
}

/** 利用者がこの前提を確認した（AI仮説の basis は変えない） */
export function provenanceConfirm(prev: Record<string, AssumptionProvenance> | undefined, key: string): Record<string, AssumptionProvenance> {
  const next: Record<string, AssumptionProvenance> = { ...(prev ?? {}) };
  const before = next[key];
  if (before) next[key] = { ...before, userConfirmed: true };
  return next;
}

export function provenanceLabel(p: AssumptionProvenance | undefined): string {
  if (!p) return '出所未記録（出所不明）';
  const base =
    p.source === 'AI_DRAFT'
      ? ({ HYPOTHESIS: 'AIの仮説', DERIVED: 'AIが既存情報から計算', MISSING: '根拠不足（未算定）', PRESET: '固定プリセット', USER_DATA: 'AIの仮説' } as Record<string, string>)[p.basis] ?? 'AIの仮説'
      : p.source === 'PRESET'
        ? '固定プリセット（利用者が選択）'
        : p.source === 'USER_INPUT'
          ? '利用者が入力'
          : '出所不明';
  const notes = [p.userEdited ? '利用者が修正' : '', p.userConfirmed ? '利用者が確認済み' : ''].filter(Boolean);
  return notes.length ? `${base}（${notes.join('・')}）` : base;
}

/** 未確認の前提・今後調べること */
export function openItemsOf(reasoning: ProjectDraftReasoning | undefined): string[] {
  if (!reasoning) return [];
  const items = [...(reasoning.verificationItems ?? [])];
  for (const [key, p] of Object.entries(reasoning.provenance ?? {})) {
    if (p.userConfirmed) continue;
    if (p.basis === 'HYPOTHESIS' || p.basis === 'MISSING') {
      items.push(`「${ASSUMPTION_LABEL[key] ?? key}」の根拠を確認する`);
    }
  }
  return items;
}

