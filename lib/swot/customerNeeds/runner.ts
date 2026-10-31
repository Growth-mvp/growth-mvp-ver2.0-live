import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import type { MarketCategory, SearchPlan } from '../marketTaxonomy';
import { selectNeedThemesForRoles } from './catalog';
import { buildIndustryNeedPlan, buildNeedSearchPlan } from './searchPlan';
import {
  buildRoleAnalysisInput,
  buildRoleAnalysisSchema,
  parseRoleAnalysis,
  type CustomerRole,
} from './roles';

export type InvokeJson = (params: ResponseCreateParamsNonStreaming) => Promise<string>;

/** 事業ごとの顧客構造の材料。分類は、その事業の入力から照合された公開分類だけ */
export type SegmentInfo = {
  rank: number;
  name: string;
  summary: string;
  scope: string;
  mainProductsServices: string[];
  keyCustomers: string[];
  productCategories: MarketCategory[];
  customerCategories: MarketCategory[];
};

export type SegmentRoles = { rank: number; name: string; roles: CustomerRole[] };

export type SegmentPlanReport = {
  rank: number;
  name: string;
  /** categories: 事業の分類で計画 / industry: 業種レベルで計画 / none: 計画なし */
  planKind: 'categories' | 'industry' | 'none';
  categoryIds: string[];
  /** 役割から顧客業界を確認できたか（確認できなければ製品の分類だけで探す） */
  customerConfirmed: boolean;
  /** 計画を作らなかった理由、または計画を業種レベルにした理由 */
  reason: 'no_public_category' | 'no_industry' | 'customer_unconfirmed' | null;
};

const MAX_NEED_SEGMENTS = 3;

const ROLE_INSTRUCTIONS =
  '与えられた事業の情報だけから、顧客・利用者の役割を整理する内部分析です。Web検索は使わず、入力に無い役割は作らないでください。出力はJSONのみです。';

/** 事業区分ごとに顧客の役割を推定する。1事業の失敗は、その事業だけ役割なし（推測で埋めない）として扱う */
export async function inferSegmentRoles(args: {
  segments: readonly SegmentInfo[];
  businessContent: string;
  params: { model: string; max_output_tokens: number; reasoning?: { effort: 'low' } };
  invoke: InvokeJson;
}): Promise<SegmentRoles[]> {
  const targets = args.segments.slice(0, MAX_NEED_SEGMENTS);
  return Promise.all(
    targets.map(async (seg) => {
      const candidates = seg.customerCategories.map((c) => ({ id: c.id, label: c.label }));
      const allowed = candidates.map((c) => c.id);
      try {
        const text = await args.invoke({
          ...args.params,
          instructions: ROLE_INSTRUCTIONS,
          input: buildRoleAnalysisInput({ businessContent: args.businessContent, segments: [seg] }, candidates),
          text: {
            format: { type: 'json_schema', name: 'customer_roles', schema: buildRoleAnalysisSchema(allowed), strict: true },
          },
          store: false,
        });
        return { rank: seg.rank, name: seg.name, roles: parseRoleAnalysis(JSON.parse(text), allowed) };
      } catch {
        return { rank: seg.rank, name: seg.name, roles: [] };
      }
    })
  );
}

/**
 * 事業ごとに、顧客課題の検索計画を作る。
 * - 製品の分類と、役割が関係すると確認できた顧客業界の分類だけを使う（事業全体の顧客を全製品に当てはめない）
 * - 分類が無ければ業種レベルの計画に切り替える（業種も無ければ作らない）
 * - 作らなかった・業種にした理由は報告に残す
 */
export function buildSegmentNeedPlans(args: {
  industryLabel: string;
  regions: readonly string[];
  segments: readonly SegmentInfo[];
  segmentRoles: readonly SegmentRoles[];
}): { plans: SearchPlan[]; reports: SegmentPlanReport[] } {
  const plans: SearchPlan[] = [];
  const reports: SegmentPlanReport[] = [];
  for (const seg of args.segments.slice(0, MAX_NEED_SEGMENTS)) {
    const roles = args.segmentRoles.find((r) => r.rank === seg.rank)?.roles ?? [];
    const chosen = new Set(roles.flatMap((r) => r.categoryIds ?? []));
    const customers = seg.customerCategories.filter((c) => chosen.has(c.id));
    const customerConfirmed = customers.length > 0;
    const themes = selectNeedThemesForRoles(roles);
    const categories = [...seg.productCategories, ...customers];
    const base = { rank: seg.rank, name: seg.name, customerConfirmed };

    if (categories.length > 0) {
      const plan = buildNeedSearchPlan({ industryLabel: args.industryLabel, regions: args.regions, categories, themes });
      if (plan) {
        plans.push({ ...plan, segment: seg.name });
        reports.push({
          ...base,
          planKind: 'categories',
          categoryIds: plan.categoryIds,
          reason: customerConfirmed || seg.customerCategories.length === 0 ? null : 'customer_unconfirmed',
        });
        continue;
      }
    }

    const industry = buildIndustryNeedPlan({ industryLabel: args.industryLabel, regions: args.regions, themes });
    if (industry) {
      plans.push({ ...industry, segment: seg.name });
      reports.push({ ...base, planKind: 'industry', categoryIds: [], reason: 'no_public_category' });
      continue;
    }
    reports.push({
      ...base,
      planKind: 'none',
      categoryIds: [],
      reason: args.industryLabel ? 'no_public_category' : 'no_industry',
    });
  }
  return { plans, reports };
}
