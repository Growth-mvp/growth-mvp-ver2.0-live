import { industryOptions } from '@/utils/industryTemplates';
import { matchCompanyMarkets, planSearchCalls } from '@/lib/swot/marketTaxonomy';
import type { StrategyData } from '@/types/strategy';

type QuerySource = Pick<StrategyData, 'industry' | 'businessContent' | 'businessSegments'>;

export type PublicSearchQuery = {
  input: string;
  industryLabel: string;
  categoryIds: string[];
  categoryLabels: string[];
};

export type PublicSearchQueryResult =
  | { ok: true; query: PublicSearchQuery }
  | { ok: false; reason: 'no_public_scope' };

const UNSPECIFIED_INDUSTRY_CODE = 'other';

/** 業種コードを許可済みの表示名に変換する。その他・自由記述・未登録は空（検索に使わない） */
export function publicIndustryLabel(code: string | undefined): string {
  const value = (code ?? '').trim();
  if (!value || value === UNSPECIFIED_INDUSTRY_CODE) return '';
  return industryOptions.find((o) => o.value === value)?.label ?? '';
}

/**
 * 検索入力は、業種ラベル・公開市場分類のラベルとテーマだけで組み立てる。
 * 事業の文章や顧客名は照合にだけ使い、検索入力には入れない（照合結果は分類 ID に変換される）。
 */
export function buildPublicSearchQuery(source: QuerySource): PublicSearchQueryResult {
  const industryLabel = publicIndustryLabel(source.industry);
  const segments = (source.businessSegments ?? []).map((s) => ({
    revenue: typeof s.revenue === 'number' ? s.revenue : undefined,
    productTexts: [s.name, s.summary ?? '', s.scope ?? '', ...(s.mainProductsServices ?? [])],
    customerTexts: s.keyCustomers ?? [],
  }));
  const match = matchCompanyMarkets({ businessContent: source.businessContent ?? '', segments });
  const plans = planSearchCalls({ industryLabel, regions: [], match });
  const plan = plans.find((p) => p.id === 'product_customer') ?? plans[0];

  if (plan) {
    return {
      ok: true,
      query: {
        input: plan.input,
        industryLabel,
        categoryIds: plan.categoryIds,
        categoryLabels: plan.categoryLabels,
      },
    };
  }
  if (!industryLabel) return { ok: false, reason: 'no_public_scope' };

  return {
    ok: true,
    query: {
      input: buildIndustryOnlyInput(industryLabel),
      industryLabel,
      categoryIds: [],
      categoryLabels: [],
    },
  };
}

function buildIndustryOnlyInput(industryLabel: string): string {
  return [
    `業界: ${industryLabel}`,
    '次の一般的な観点について、この業界の公開情報から直近の動向と今後の変化を調べてください。',
    '- 需要・市場規模の変化',
    '- 競争・競合の動向',
    '- 規制・制度の変化',
    '- 技術革新の動向',
    '',
    '1テーマにつき1件、事実を1文で書いてください。数値には、実績か予測か、年度・暦年を明記してください。',
  ].join('\n');
}
