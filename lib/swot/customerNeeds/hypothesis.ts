import type { RoleBasis, RoleKey } from './roles';

/**
 * 顧客課題から成長機会への変換の構造。
 * 事実（出典つき）と仮説（推定）を別の欄に分け、確認できない項目は unverified に残す。
 */
export type NeedHypothesis = {
  id: string;
  who: RoleKey;
  whoLabel: string;
  roleBasis: RoleBasis;
  problem: string;
  desiredOutcome: string | null;
  whyCurrentFails: string | null;
  breadth: 'public_observed' | 'partial' | 'unknown';
  payer: RoleKey | null;
  companyLink: string | null;
  opportunity: string;
  facts: Array<{ text: string; sourceUrl: string | null; bodyChecked: boolean }>;
  hypotheses: string[];
  unverified: string[];
  discoveryPath: 'customer_need';
};

export type NeedGrade = 'verified_public' | 'hypothesis';

/**
 * 公開情報で確認できた、と言えるのは次をすべて満たす場合だけ。
 * 広がりの裏付け・対価を払う相手・自社との接点・出典つきの事実。
 */
export function gradeNeedHypothesis(h: NeedHypothesis): { grade: NeedGrade; reasons: string[] } {
  const reasons: string[] = [];
  if (h.breadth !== 'public_observed') reasons.push('課題の広がりを示す公開情報が未確認');
  if (!h.payer) reasons.push('対価を払う相手が未確認');
  if (!h.companyLink) reasons.push('自社の事業・能力との接点が未確認');
  if (h.facts.length === 0 || h.facts.some((f) => !f.sourceUrl)) reasons.push('事実に出典が付いていない');
  if (h.facts.some((f) => !!f.sourceUrl && !f.bodyChecked)) reasons.push('事実の出典は本文が未確認（URLだけでは確認済みとしない）');
  return { grade: reasons.length ? 'hypothesis' : 'verified_public', reasons };
}

/** 課題の主体は、役割の推定で根拠（input / public / estimated）のある役割に限る。根拠の無い役割は主体にしない */
export function isWhoSupported(h: NeedHypothesis, roles: readonly { role: RoleKey; basis: RoleBasis }[]): boolean {
  return roles.some((r) => r.role === h.who);
}

/** 仕様への適合を確認する項目。実際の発見力は評価できないため、構造と根拠の規則だけを見る */
export function specChecks(h: NeedHypothesis, roles: readonly { role: RoleKey; basis: RoleBasis }[]) {
  return {
    whoIsSupportedByRoles: isWhoSupported(h, roles),
    problemIsSpecific: h.problem.trim().length >= 15,
    desiredOutcomeStatedOrUnverified: !!h.desiredOutcome || h.unverified.includes('desiredOutcome'),
    payerStatedOrUnverified: !!h.payer || h.unverified.includes('payer'),
    companyLinkStatedOrUnverified: !!h.companyLink || h.unverified.includes('companyLink'),
    factsHaveSources: h.facts.every((f) => !!f.sourceUrl && f.bodyChecked),
    factsAndHypothesesSeparated: h.facts.every((f) => !h.hypotheses.includes(f.text)),
  };
}

/** 構造の最低限の検査。欠けた任意項目は unverified に加えて明示する */
export function completeNeedHypothesis(h: NeedHypothesis): NeedHypothesis {
  const unverified = new Set(h.unverified);
  if (!h.desiredOutcome) unverified.add('desiredOutcome');
  if (!h.whyCurrentFails) unverified.add('whyCurrentFails');
  if (!h.payer) unverified.add('payer');
  if (!h.companyLink) unverified.add('companyLink');
  if (h.breadth !== 'public_observed') unverified.add('breadth');
  return { ...h, unverified: [...unverified] };
}
