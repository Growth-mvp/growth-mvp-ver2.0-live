import { z } from 'zod';

export const ROLE_KEYS = ['direct_customer', 'user', 'end_beneficiary', 'buying_decision_maker'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** input: STAGE1 の入力から確認できる / public: 公開情報に基づく / estimated: AI の推定（仮説） */
export const ROLE_BASES = ['input', 'public', 'estimated'] as const;
export type RoleBasis = (typeof ROLE_BASES)[number];

export type CustomerRole = {
  role: RoleKey;
  basis: RoleBasis;
  label: string;
  evidence: string | null;
};

export type Stage1CustomerInput = {
  businessContent?: string;
  customerSegment?: string;
  segments?: Array<{
    name?: string;
    summary?: string;
    scope?: string;
    mainProductsServices?: string[];
    keyCustomers?: string[];
  }>;
};

const ROLE_LABEL_JA: Record<RoleKey, string> = {
  direct_customer: '直接顧客（製品・サービスを購入する相手）',
  user: '利用者（実際に使う人や企業）',
  end_beneficiary: '最終的な便益を受ける顧客',
  buying_decision_maker: '購買意思決定者（採用・仕様・予算に影響する人）',
};

/** 内部のAI分析に渡す入力。企業情報を含むため、Web検索には使わない */
export function buildRoleAnalysisInput(s: Stage1CustomerInput): string {
  const lines: string[] = [];
  if (s.businessContent?.trim()) lines.push(`【事業内容】${s.businessContent.trim()}`);
  if (s.customerSegment?.trim()) lines.push(`【顧客区分（自由記述）】${s.customerSegment.trim()}`);
  (s.segments ?? []).forEach((seg, i) => {
    lines.push(`【事業${i + 1}】${seg.name?.trim() || '（名称なし）'}`);
    if (seg.summary?.trim()) lines.push(`  概要: ${seg.summary.trim()}`);
    if (seg.scope?.trim()) lines.push(`  範囲: ${seg.scope.trim()}`);
    const products = (seg.mainProductsServices ?? []).filter((x) => x.trim());
    if (products.length) lines.push(`  製品・サービス: ${products.join('、')}`);
    const customers = (seg.keyCustomers ?? []).filter((x) => x.trim());
    if (customers.length) lines.push(`  主要顧客: ${customers.join('、')}`);
  });
  return [
    ...lines,
    '',
    '上の情報から、次の4つの役割を整理してください: ' + ROLE_KEYS.map((k) => `${k}（${ROLE_LABEL_JA[k]}）`).join('、') + '。',
    '役割は重複してよい。basis は次の3種:',
    '- input: 上の入力欄の記載から確認できる（evidence に入力欄名と根拠の語を書く）',
    '- public: 公開情報に基づく（evidence に出典の名称を書く）',
    '- estimated: 入力からの推定（evidence は null）',
    '入力にも推定の根拠にも無い役割は出力しないでください。無理に埋めないでください。',
  ].join('\n');
}

const RoleItem = z.object({
  role: z.enum(ROLE_KEYS),
  basis: z.enum(ROLE_BASES),
  label: z.string().trim().min(1).max(80),
  evidence: z.string().trim().max(200).nullable().optional(),
});

/** AI の出力を検証する。根拠の無い input / public は estimated に降格し、役割ごとの件数を3件に抑える */
export function parseRoleAnalysis(raw: unknown): CustomerRole[] {
  const list = z.object({ roles: z.array(z.unknown()).max(20) }).safeParse(raw);
  if (!list.success) return [];
  const count: Partial<Record<RoleKey, number>> = {};
  const out: CustomerRole[] = [];
  for (const item of list.data.roles) {
    const r = RoleItem.safeParse(item);
    if (!r.success) continue;
    const role = r.data.role;
    if ((count[role] ?? 0) >= 3) continue;
    const evidence = r.data.evidence?.trim() || null;
    const basis: RoleBasis = r.data.basis !== 'estimated' && !evidence ? 'estimated' : r.data.basis;
    out.push({ role, basis, label: r.data.label, evidence: basis === 'estimated' ? null : evidence });
    count[role] = (count[role] ?? 0) + 1;
  }
  return out;
}

export type RoleCoverage = 'input' | 'public' | 'estimated' | 'unconfirmed';

/** 役割ごとに、最も強い根拠の区分を返す。無い役割は unconfirmed（埋めない） */
export function roleCoverage(roles: readonly CustomerRole[]): Record<RoleKey, RoleCoverage> {
  const rank: Record<RoleCoverage, number> = { unconfirmed: 0, estimated: 1, public: 2, input: 3 };
  const out = Object.fromEntries(ROLE_KEYS.map((k) => [k, 'unconfirmed'])) as Record<RoleKey, RoleCoverage>;
  for (const r of roles) {
    if (rank[r.basis] > rank[out[r.role]]) out[r.role] = r.basis;
  }
  return out;
}
