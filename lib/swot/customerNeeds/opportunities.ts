import { z } from 'zod';
import { ROLE_KEYS, type CustomerRole, type RoleKey } from './roles';
import { completeNeedHypothesis, gradeNeedHypothesis, type EvidenceRelation, type NeedHypothesis } from './hypothesis';
import type { OpportunityGroup } from '../opportunityGroups';

export const NEED_BREADTHS = ['public_observed', 'partial', 'unknown'] as const;
export type NeedBreadth = (typeof NEED_BREADTHS)[number];

export const EVIDENCE_RELATIONS = ['same_customer', 'adjacent', 'different', 'unknown'] as const;

export const MAX_NEED_OPPORTUNITIES = 6;
export const MAX_NEED_PER_SEGMENT = 2;

/** 顧客課題から機会への1件。事業・課題の主体・課題・成果・既存手段の不足・支払う相手・自社との接点・顧客価値の変化・購買判断・機会を分けて持つ */
export const NEED_OPPORTUNITY_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'segmentName',
    'who',
    'problem',
    'desiredOutcome',
    'whyCurrentFails',
    'payer',
    'companyLink',
    'valueShift',
    'purchaseImpact',
    'breadth',
    'opportunity',
    'basis',
    'evidence',
    'sourceIndex',
    'evidenceTarget',
    'evidenceRelation',
  ],
  properties: {
    segmentName: { type: ['string', 'null'] },
    who: { type: 'string', enum: [...ROLE_KEYS] },
    problem: { type: 'string' },
    desiredOutcome: { type: ['string', 'null'] },
    whyCurrentFails: { type: ['string', 'null'] },
    payer: { type: ['string', 'null'], enum: [...ROLE_KEYS, null] },
    companyLink: { type: ['string', 'null'] },
    valueShift: { type: ['string', 'null'] },
    purchaseImpact: { type: ['string', 'null'] },
    breadth: { type: 'string', enum: [...NEED_BREADTHS] },
    opportunity: { type: 'string' },
    basis: { type: 'string', enum: ['fact', 'hypothesis'] },
    evidence: { type: 'string' },
    sourceIndex: { type: ['integer', 'null'] },
    evidenceTarget: { type: ['string', 'null'] },
    evidenceRelation: { type: 'string', enum: [...EVIDENCE_RELATIONS] },
  },
} as const;

export const NEED_OPPORTUNITIES_PROPERTY = {
  type: 'array',
  minItems: 0,
  maxItems: MAX_NEED_OPPORTUNITIES,
  items: NEED_OPPORTUNITY_ITEM_SCHEMA,
} as const;

export type NeedOpportunityRaw = {
  segmentName: string | null;
  who: RoleKey;
  problem: string;
  desiredOutcome: string | null;
  whyCurrentFails: string | null;
  payer: RoleKey | null;
  companyLink: string | null;
  valueShift: string | null;
  purchaseImpact: string | null;
  breadth: NeedBreadth;
  opportunity: string;
  basis: 'fact' | 'hypothesis';
  evidence: string;
  sourceIndex: number | null;
  evidenceTarget: string | null;
  evidenceRelation: EvidenceRelation;
};

/** 事実の根拠としての使われ方。fact: 本文確認済みで対象が顧客と一致 / reference: 参考のみ / mismatch: 対象不一致で使わない / none: 出典なし */
export type EvidenceUse = 'fact' | 'reference' | 'mismatch' | 'none';

export type NeedFields = {
  discoveryPath: 'customer_need';
  segmentName: string | null;
  who: RoleKey;
  whoLabel: string;
  problem: string;
  desiredOutcome: string | null;
  whyCurrentFails: string | null;
  payer: RoleKey | null;
  companyLink: string | null;
  valueShift: string | null;
  purchaseImpact: string | null;
  breadth: NeedBreadth;
  evidenceTarget: string | null;
  evidenceRelation: EvidenceRelation;
  evidenceUse: EvidenceUse;
  unverified: string[];
  grade: 'verified_public' | 'hypothesis';
  gradeReasons: string[];
};

export type NeedItem = {
  group?: OpportunityGroup;
  text: string;
  basis: 'fact' | 'hypothesis';
  evidence: string;
  sourceIndex: number | null;
  need: NeedFields;
};

const trimmed = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().slice(0, max))
    .refine((s) => s.length > 0);

const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => {
      const v = (s ?? '').trim().slice(0, max);
      return v === '' ? null : v;
    });

const RawItem = z.object({
  segmentName: optionalText(100),
  who: z.enum(ROLE_KEYS),
  problem: trimmed(300),
  desiredOutcome: optionalText(200),
  whyCurrentFails: optionalText(200),
  payer: z.enum(ROLE_KEYS).nullish().transform((v) => v ?? null),
  companyLink: optionalText(200),
  valueShift: optionalText(200),
  purchaseImpact: optionalText(200),
  breadth: z.enum(NEED_BREADTHS),
  opportunity: trimmed(300),
  basis: z.enum(['fact', 'hypothesis']),
  evidence: z.string().nullish().transform((s) => (s ?? '').trim().slice(0, 300)),
  sourceIndex: z.number().int().nullish().transform((v) => v ?? null),
  evidenceTarget: optionalText(200),
  evidenceRelation: z.enum(EVIDENCE_RELATIONS).catch('unknown'),
});

/** AI の出力から顧客課題の項目を取り出す。形式の不正な項目は捨てる（件数の上限は変換の段階で掛ける） */
export function parseNeedOpportunities(raw: unknown): NeedOpportunityRaw[] {
  const list = z.object({ customerNeedOpportunities: z.array(z.unknown()).max(12) }).safeParse(raw);
  if (!list.success) return [];
  const out: NeedOpportunityRaw[] = [];
  for (const item of list.data.customerNeedOpportunities) {
    const r = RawItem.safeParse(item);
    if (!r.success) continue;
    out.push(r.data);
  }
  return out;
}

export type NeedSourceLite = { index: number; url: string; contentVerified?: boolean };
export type NeedFindingLite = { statement: string; sourceIndex: number; segment?: string };

const CUSTOMER_TERM_STOP = ['メーカー', '企業', '製造業', '製品', '事業', '顧客', '市場', 'サービス', '業界', '向け', '組織', '利用者', '購入者', 'など'];

/** 顧客業界のラベルから、出典の文と照合する語を取り出す（例：「食品・飲料メーカー」→ 食品、飲料） */
function termsOfLabel(label: string): string[] {
  return label
    .split(/[・、，,\s（）()]/)
    .map((s) => s.replace(/メーカー$/, '').trim())
    .filter((s) => s.length >= 2 && !CUSTOMER_TERM_STOP.includes(s));
}

export type NeedDropReason =
  | 'who_unsupported'
  | 'opportunity_empty'
  | 'segment_cap'
  | 'total_cap';

/**
 * 顧客課題の項目を、根拠の規則で検査して機会の候補にする。
 * - 主体は内部分析の役割に存在する場合だけ残す（役割に無い主体は作らない）
 * - 事業は、事業区分の名前に一致する場合だけ特定する（不明は未特定として残し、未確認に記録する）
 * - 出典は、その事業の検索で得た主張からだけ使う（別の事業の検索結果は根拠にしない）
 * - 調査対象が顧客と異なる出典は根拠にしない。本文が未確認の出典は参考どまり
 * - 広がり・支払う相手・自社との接点・顧客価値の変化・購買判断への影響がそろわない項目は仮説にする
 */
export function toNeedItems(args: {
  items: readonly NeedOpportunityRaw[];
  roles: readonly CustomerRole[];
  findings: readonly NeedFindingLite[];
  sources: readonly NeedSourceLite[];
  segments: readonly string[];
  labelOf: (role: RoleKey) => string;
  categoryLabelOf?: (categoryId: string) => string;
}): { items: NeedItem[]; dropped: Record<NeedDropReason, number>; evidenceUse: Record<EvidenceUse, number> } {
  const dropped: Record<NeedDropReason, number> = { who_unsupported: 0, opportunity_empty: 0, segment_cap: 0, total_cap: 0 };
  const evidenceUse: Record<EvidenceUse, number> = { fact: 0, reference: 0, mismatch: 0, none: 0 };
  const items: NeedItem[] = [];
  const roleBasis = new Map<RoleKey, CustomerRole['basis']>();
  const roleCategoryIds = new Map<RoleKey, string[]>();
  for (const r of args.roles) {
    const prev = roleBasis.get(r.role);
    if (!prev || (prev === 'estimated' && r.basis !== 'estimated')) roleBasis.set(r.role, r.basis);
    roleCategoryIds.set(r.role, [...(roleCategoryIds.get(r.role) ?? []), ...(r.categoryIds ?? [])]);
  }
  const customerTerms = (who: RoleKey): string[] => {
    const labelOf = args.categoryLabelOf ?? ((id: string) => id);
    return [...new Set((roleCategoryIds.get(who) ?? []).flatMap((id) => termsOfLabel(labelOf(id))))];
  };
  const sourceOf = new Map(args.sources.map((s) => [s.index, s] as const));
  const segmentNames = new Set(args.segments);

  args.items.forEach((item, i) => {
    const basisOfWho = roleBasis.get(item.who);
    if (!basisOfWho) {
      dropped.who_unsupported++;
      return;
    }
    if (!item.opportunity) {
      dropped.opportunity_empty++;
      return;
    }
    const segmentName = item.segmentName && segmentNames.has(item.segmentName) ? item.segmentName : null;
    const source = item.sourceIndex !== null ? sourceOf.get(item.sourceIndex) : undefined;

    const scoped = args.findings.filter(
      (f) => source !== undefined && f.sourceIndex === source.index && (!f.segment || !segmentName || f.segment === segmentName)
    );
    const crossSegment = source !== undefined && scoped.length === 0;

    const terms = customerTerms(item.who);
    const customerTermFound = terms.some((t) => scoped.some((f) => f.statement.includes(t)));
    let use: EvidenceUse = 'none';
    if (source && !crossSegment) {
      if (item.evidenceRelation === 'different') use = 'mismatch';
      else if (item.evidenceRelation === 'same_customer' && source.contentVerified === true && customerTermFound) use = 'fact';
      else use = 'reference';
    } else if (source && crossSegment) {
      use = 'mismatch';
    }
    evidenceUse[use]++;
    const sourceIndex = source && use !== 'mismatch' && use !== 'none' ? source.index : null;

    const payer = item.payer && roleBasis.has(item.payer) ? item.payer : null;
    const facts = sourceIndex === null
      ? []
      : scoped.map((f) => ({ text: f.statement, sourceUrl: source?.url ?? null, bodyChecked: source?.contentVerified === true }));

    const hypothesis: NeedHypothesis = completeNeedHypothesis({
      id: `need-${i + 1}`,
      who: item.who,
      whoLabel: args.labelOf(item.who),
      roleBasis: basisOfWho,
      problem: item.problem,
      desiredOutcome: item.desiredOutcome,
      whyCurrentFails: item.whyCurrentFails,
      breadth: item.breadth,
      payer,
      companyLink: item.companyLink,
      opportunity: item.opportunity,
      facts,
      hypotheses: item.basis === 'hypothesis' ? [item.opportunity] : [],
      unverified: [
        ...(basisOfWho === 'estimated' ? ['who_estimated'] : []),
        ...(segmentName === null ? ['segment'] : []),
        ...(use === 'mismatch' ? [crossSegment ? 'source_other_segment' : 'evidence_target_mismatch'] : []),
        ...(use === 'reference' ? ['evidence_not_fact'] : []),
        ...(use === 'reference' && item.evidenceRelation === 'same_customer' && source?.contentVerified === true && !customerTermFound
          ? ['customer_match_unconfirmed']
          : []),
      ],
      discoveryPath: 'customer_need',
      valueShift: item.valueShift,
      purchaseImpact: item.purchaseImpact,
      evidenceTarget: item.evidenceTarget,
      evidenceRelation: item.evidenceRelation,
    });
    const gradedBase = gradeNeedHypothesis(hypothesis);
    // 出典が事実として使えない項目は、公開情報で確認済みとしない（参考・対象不一致・出典なしを格付けに残す）
    const evidenceReason: Record<EvidenceUse, string | null> = {
      fact: null,
      reference: '出典は参考どまり（対象の一致か本文確認が未了）',
      mismatch: '出典は別の事業または対象不一致のため根拠にしない',
      none: '事実の出典が無い',
    };
    const graded = use === 'fact'
      ? gradedBase
      : {
          grade: 'hypothesis' as const,
          reasons: [...gradedBase.reasons, ...(evidenceReason[use] ? [evidenceReason[use] as string] : [])],
        };
    // 機会の文は将来の成立を述べるため、常に仮説。課題の事実は evidenceUse で別に示す（支払い・自社接点の有無に依らない）
    const basis: 'fact' | 'hypothesis' = 'hypothesis';

    items.push({
      group: 'new_customer_use',
      text: item.opportunity,
      basis,
      evidence: item.evidence,
      sourceIndex,
      need: {
        discoveryPath: 'customer_need',
        segmentName,
        who: item.who,
        whoLabel: args.labelOf(item.who),
        problem: item.problem,
        desiredOutcome: item.desiredOutcome,
        whyCurrentFails: item.whyCurrentFails,
        payer,
        companyLink: item.companyLink,
        valueShift: item.valueShift,
        purchaseImpact: item.purchaseImpact,
        breadth: item.breadth,
        evidenceTarget: item.evidenceTarget,
        evidenceRelation: item.evidenceRelation,
        evidenceUse: use,
        unverified: hypothesis.unverified,
        grade: graded.grade,
        gradeReasons: graded.reasons,
      },
    });
  });
  return { items, dropped, evidenceUse };
}

/**
 * 事業ごとの上限と全体の上限を掛ける。事業の順に、先に来た項目を採る（特定の事業だけが並びで優先されない）。
 * 上限で外した項目は理由を数える。根拠の無い項目を埋めるためには使わない。
 */
export function capNeedItemsPerSegment(
  items: readonly NeedItem[],
  segmentOrder: readonly string[],
  perSegment = MAX_NEED_PER_SEGMENT,
  total = MAX_NEED_OPPORTUNITIES
): { items: NeedItem[]; dropped: Record<'segment_cap' | 'total_cap', number> } {
  const dropped = { segment_cap: 0, total_cap: 0 };
  const perCount = new Map<string, number>();
  const kept: NeedItem[] = [];
  const ordered = [...items].sort((a, b) => {
    const ia = a.need.segmentName ? segmentOrder.indexOf(a.need.segmentName) : segmentOrder.length;
    const ib = b.need.segmentName ? segmentOrder.indexOf(b.need.segmentName) : segmentOrder.length;
    return ia - ib;
  });
  for (const item of ordered) {
    const key = item.need.segmentName ?? '';
    const used = perCount.get(key) ?? 0;
    if (used >= perSegment) {
      dropped.segment_cap++;
      continue;
    }
    if (kept.length >= total) {
      dropped.total_cap++;
      continue;
    }
    perCount.set(key, used + 1);
    kept.push(item);
  }
  return { items: kept, dropped };
}
