import { regionReference, type CompanyMatch, type SearchPlan } from '../marketTaxonomy';
import { selectedNeedThemes } from './catalog';

/**
 * 顧客課題の検索テンプレート。入力は、業界の公開ラベル（許可済みの場合のみ）・許可済みの地域名・
 * 公開分類ラベル・固定カタログのテーマだけ。企業の自由記述・役割の文・ニーズ仮説は入れない。
 */
export function buildNeedSearchPlan(args: {
  industryLabel: string;
  regions: readonly string[];
  match: CompanyMatch;
}): SearchPlan | null {
  const primary = args.match.segments.flatMap((s) => [...s.product, ...s.customer]);
  if (primary.length === 0) return null;
  const unique = [...new Map(primary.map((c) => [c.id, c])).values()];
  const input = [
    ...(args.industryLabel ? [`業界: ${args.industryLabel}`] : []),
    regionReference(args.regions),
    `製品・顧客市場（公開分類）: ${unique.map((c) => c.label).join('、')}`,
    '',
    '次の観点で、上の市場の利用者・顧客に関する公開情報を探してください。課題があるという前提では探さず、課題が小さいことを示す情報も同じように探してください。各行は「市場ラベル: 事実を1文」で書き、市場ラベルは上の一覧の名前をそのまま使ってください。',
    ...selectedNeedThemes().map((t) => `- ${t.theme}`),
    '',
    '調査の主体・時期・対象・標本数・地域が分かる場合は必ず書いてください。確認できない項目は書かないでください。',
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
