import { regionReference, type CompanyMatch, type MarketCategory, type SearchPlan } from '../marketTaxonomy';
import { selectedNeedThemes, type NeedTheme } from './catalog';

const themeLines = (themes: readonly NeedTheme[]) => themes.map((t) => `- ${t.theme}`);

const SEARCH_PERSPECTIVE =
  '次の観点で、上の市場の利用者・顧客に関する公開情報を探してください。課題があるという前提では探さず、課題が小さいことを示す情報も同じように探してください。各行は「市場ラベル: 事実を1文」で書き、市場ラベルは上の一覧の名前をそのまま使ってください。';

const SURVEY_NOTE =
  '調査の主体・時期・対象・標本数・地域が分かる場合は必ず書いてください。確認できない項目は書かないでください。';

/**
 * 顧客課題の検索テンプレート。入力は、業界の公開ラベル（許可済みの場合のみ）・許可済みの地域名・
 * 公開分類ラベル・固定カタログのテーマだけ。企業の自由記述・役割の文・ニーズ仮説は入れない。
 * categories を指定すると、その分類だけを使う（事業ごとの計画）。指定が無い場合は match の全分類を使う。
 */
export function buildNeedSearchPlan(args: {
  industryLabel: string;
  regions: readonly string[];
  match?: CompanyMatch;
  categories?: readonly MarketCategory[];
  themes?: readonly NeedTheme[];
}): SearchPlan | null {
  const source = args.categories ?? (args.match ? args.match.segments.flatMap((s) => [...s.product, ...s.customer]) : []);
  if (source.length === 0) return null;
  const unique = [...new Map(source.map((c) => [c.id, c])).values()];
  const input = [
    ...(args.industryLabel ? [`業界: ${args.industryLabel}`] : []),
    regionReference(args.regions),
    `製品・顧客市場（公開分類）: ${unique.map((c) => c.label).join('、')}`,
    '',
    SEARCH_PERSPECTIVE,
    ...themeLines(args.themes ?? selectedNeedThemes()),
    '',
    SURVEY_NOTE,
  ].join('\n');
  return {
    id: 'customer_need',
    categoryIds: unique.map((c) => c.id),
    categoryLabels: unique.map((c) => c.label),
    categories: unique.map((c) => ({ id: c.id, label: c.label, theme: c.theme })),
    layers: ['product', 'customer'],
    input,
  };
}

/**
 * 事業に一致する公開分類が無い場合の、業種レベルの顧客課題の検索テンプレート。
 * 業種は許可された業種ラベルだけを使う。事業の自由記述は入れない。業種が無ければ作らない。
 */
export function buildIndustryNeedPlan(args: {
  industryLabel: string;
  regions: readonly string[];
  themes?: readonly NeedTheme[];
}): SearchPlan | null {
  if (!args.industryLabel) return null;
  const input = [
    `業界: ${args.industryLabel}`,
    regionReference(args.regions),
    '',
    `この業界の製品・サービスを利用する人や、それを購入する企業に関する公開情報を探してください。${SEARCH_PERSPECTIVE.replace('上の市場の', 'この業界の')}`,
    ...themeLines(args.themes ?? selectedNeedThemes()),
    '',
    SURVEY_NOTE,
  ].join('\n');
  return {
    id: 'customer_need',
    categoryIds: [],
    categoryLabels: [],
    categories: [],
    layers: [],
    input,
  };
}
