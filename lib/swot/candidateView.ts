import { candidatePoolOf, type PoolCandidate, type SelectionEntry } from './candidatePool';
import { GROUP_LABEL_JA, OPPORTUNITY_GROUPS, type OpportunityGroup } from './opportunityGroups';

/** 機会の上限（保存と生成の両方で守る） */
export const OPPORTUNITY_CAP = 30;
/** 1回の追加探索で増やす件数 */
export const EXTEND_BATCH = 8;

/** A〜D の分類。分類の記録が無い過去の候補は unclassified に分ける（A〜D の件数には含めない） */
export type GroupedOpportunities = Record<OpportunityGroup, PoolCandidate[]> & { unclassified: PoolCandidate[] };

/** A〜D に分ける。分類の記録が無い過去の候補は、A に入れず unclassified に分ける（暫定の表示） */
export function groupOpportunityCandidates(candidates: readonly PoolCandidate[]): GroupedOpportunities {
  const out = {
    ...(Object.fromEntries(OPPORTUNITY_GROUPS.map((g) => [g, [] as PoolCandidate[]])) as Record<OpportunityGroup, PoolCandidate[]>),
    unclassified: [] as PoolCandidate[],
  };
  for (const c of candidates) {
    if (c.kind !== 'opportunity') continue;
    if (c.group) out[c.group].push(c);
    else out.unclassified.push(c);
  }
  return out;
}

export function opportunityCandidatesOf(suggestions: unknown): PoolCandidate[] {
  return candidatePoolOf(suggestions as never).candidates.filter((c) => c.kind === 'opportunity');
}

export function discoveryPathLabel(c: PoolCandidate): string {
  if (c.discoveryPath === 'customer_need') return '顧客課題から';
  if (c.discoveryPath === 'market') return '市場動向から';
  return '発見経路の記録なし';
}

export type EvidenceView = { kind: 'confirmed' | 'reference' | 'hypothesis' | 'mismatch'; label: string };

/**
 * 根拠の表示。確認済みと言えるのは、出典の本文と調査対象が確認された場合だけ。
 * 追加探索の候補は、既存の出典を新しい候補の裏付けとして扱わない（参考どまり）。
 */
export function evidenceViewOf(c: PoolCandidate): EvidenceView {
  if (c.evidenceUse === 'mismatch') return { kind: 'mismatch', label: '対象不一致の出典は根拠にしていません' };
  if (c.evidenceUse === 'fact') return { kind: 'confirmed', label: '出典で確認済み（本文と調査対象が一致）' };
  if (c.sourceUrl) {
    return {
      kind: 'reference',
      label: c.origin === 'extension' ? '参考出典あり（この候補の裏付けは未確認）' : '参考情報（出典あり・裏付けは未確認）',
    };
  }
  if (c.evidence) return { kind: 'hypothesis', label: '探索仮説（推論の根拠あり・出典なし）' };
  return { kind: 'hypothesis', label: '探索仮説（根拠は示していない）' };
}

const PAYER_LABEL: Record<string, string> = {
  direct_customer: '直接顧客',
  user: '利用者',
  end_beneficiary: '最終的な便益を受ける顧客',
  buying_decision_maker: '購買意思決定者',
};

/** 未確認事項の記録を、画面用の文にする。内部の記録名のうち、説明がないものは表示しない */
const UNVERIFIED_LABEL: Record<string, string> = {
  source_body_not_checked: '出典の本文は未確認',
  citation_not_linked: '根拠文の出典番号が出典に紐づいていない',
  inference_only: '出典からの推論（仮説）',
  needs_research: '根拠の調査が必要',
  breadth: '課題が広く観察されるかは未確認',
  desiredOutcome: '実現したい成果は未記述',
  whyCurrentFails: '既存手段の不足は未記述',
  payer: '対価を払う相手は未確認',
  companyLink: '自社との接点は未確認',
  valueShift: '従来の顧客価値との違いは未記述',
  purchaseImpact: '影響する購買判断は未記述',
  evidenceTarget: '出典の調査対象は未確認',
  segment: '対象事業を特定できない',
  who_estimated: '対象の役割は推定',
  evidence_target_mismatch: '出典の調査対象が顧客と異なる',
  source_other_segment: '別の事業の出典',
  evidence_not_fact: '出典は事実として使えない（参考）',
  customer_match_unconfirmed: '出典と顧客業界の一致は未確認',
};

export type DetailRow = { label: string; value: string | null };

/**
 * 候補の詳細。記録がある項目だけ値を入れ、無い項目は「記録なし」にする（AI で補完しない）。
 */
export function detailRowsOf(c: PoolCandidate, sources: readonly { index: number; title?: string; url?: string; retrievedAt?: string }[]): DetailRow[] {
  const source = c.sourceIndex !== null ? sources.find((s) => s.index === c.sourceIndex) : undefined;
  const unverified = c.unverified.map((u) => UNVERIFIED_LABEL[u]).filter((x): x is string => !!x);
  const sourceText = c.sourceUrl
    ? [source?.title ?? c.sourceUrl, c.sourceUrl].filter(Boolean).join('\n')
    : null;
  return [
    { label: '対象事業', value: c.segmentName ?? null },
    { label: '対象顧客・利用者', value: c.whoLabel ?? null },
    { label: '対価を払う主体', value: c.payer ? (PAYER_LABEL[c.payer] ?? null) : null },
    { label: '顧客や市場の変化・未充足ニーズ', value: c.targetNeed ?? null },
    { label: '顧客が実現したい成果', value: c.desiredOutcome ?? null },
    { label: '新しい価値提供の可能性', value: c.valueShift ?? null },
    { label: '影響しうる購買判断', value: c.purchaseImpact ?? null },
    { label: '自社の能力との接点', value: c.companyLink ?? null },
    { label: '出典・参考情報', value: [sourceText, c.evidence || null].filter(Boolean).join('\n') || null },
    { label: '未確認事項', value: unverified.length ? unverified.join('・') : null },
  ];
}

export type ExtendPlan = { enabled: boolean; batch: number; reason: string | null };

/** 「さらに探索」を押せるか。上限・二重実行・閲覧のみを見る（外部の根拠は必須ではない） */
export function extendPlanOf(args: { count: number; busy: boolean; locked: boolean }): ExtendPlan {
  const remaining = Math.max(0, OPPORTUNITY_CAP - args.count);
  const batch = Math.min(EXTEND_BATCH, remaining);
  if (args.locked) return { enabled: false, batch: 0, reason: '閲覧のみのため追加できません' };
  if (args.busy) return { enabled: false, batch: 0, reason: '追加探索を実行中です' };
  if (remaining === 0) return { enabled: false, batch: 0, reason: `候補は上限（${OPPORTUNITY_CAP}件）に達しています` };
  return { enabled: true, batch, reason: null };
}

/** 非同期の応答を、いま表示している会社・戦略に対してだけ反映してよいか */
export function isSameScope(
  request: { companyId: string | null; strategyId: string | null },
  now: { companyId: string | null; strategyId: string | null }
): boolean {
  return request.companyId === now.companyId && request.strategyId === now.strategyId && request.companyId !== null;
}

export function selectedEntryOf(suggestions: unknown, candidateId: string): SelectionEntry | undefined {
  const sel = (suggestions as { selection?: { entries?: Record<string, SelectionEntry> } } | undefined)?.selection;
  const e = sel?.entries?.[candidateId];
  return e && e.status === 'added' ? e : undefined;
}
