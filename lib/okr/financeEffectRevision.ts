import { guardFinanceEffectConfirmation } from '@/lib/financeEffect';
import type { FinanceEffect } from '@/types/strategy';

/* 旧 /okr の財務効果の修正。編集は保存されるまで一時的な内容に入れ、保存するまで確認済みの内容は変えない。 */

/** 修正の対象：主の効果（financeEffect）か、追加の効果の位置（financeEffects の添字） */
export type RevisionTarget = 'primary' | number;

export type LegacyRevision = { key: string; target: RevisionTarget };

/** 確認済みの効果は、「修正する」を押すまで編集できない（編集が即保存されると確認が外れるため） */
export function isEditLocked(saved: FinanceEffect | undefined, revising: boolean): boolean {
  return saved?.confirmed === true && !revising;
}

/** 修正内容を保存する値。内容が変わった・新しく確認していなければ未確認になる（既存の確認ガードで判定） */
export function revisedEffectToSave(saved: FinanceEffect | undefined, buffer: FinanceEffect | undefined): FinanceEffect | undefined {
  return guardFinanceEffectConfirmation(saved, buffer);
}

/** 確認を解除して保存する値（内容は変えず、未確認にする） */
export function unconfirmedEffect(saved: FinanceEffect | undefined): FinanceEffect | undefined {
  if (!saved) return undefined;
  const next: FinanceEffect = { ...saved, confirmed: false };
  delete next.confirmedAt;
  return next;
}
