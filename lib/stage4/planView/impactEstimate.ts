/* STAGE3に登録済みの業績の前提から、第5章の参考試算を作る。計算はプログラムで行い、AIには任せない。
 * 試算は確定値ではない。STAGE6の経路A（impactRevenueMJPY×進捗・impactOpIncomeMJPY×進捗）・経路B（確定済みの financeEffect）には書き込まず、既存の数値も変えない。
 * 将来STAGE6へ接続する際の二重計上の注意：経路Aの営業利益（40百万円）は「費用削減」の式（現行コスト×削減率）で、売上経由の営業利益とは別の効果。両者を足し合わせない。 */

type Json = Record<string, unknown>;

export type EstimateCheck = 'MATCHES_STAGE3' | 'MISMATCH' | 'UNCONFIRMED' | 'NOT_CALCULATED';

export type EstimateRow = {
  label: string;
  valueMJPY: number | null;
  formula: string | null;
  source: string;
  check: EstimateCheck;
  note: string | null;
};

export type ImpactEstimate =
  | { status: 'NOT_CALCULATED'; reason: string }
  | {
      status: 'CALCULATED';
      stage3Targets: { revenueMJPY: number | null; opIncomeMJPY: number | null };
      rows: EstimateRow[];
      consistency: string[];
      warnings: string[];
    };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const fmt = (v: number): string => String(round1(v));
const SAME = 0.05;

const KPI_MARGIN_LABEL = '用途別案件の粗利率';
const MARGIN_KPI_SOURCE = 'STAGE3の用途別案件の粗利率（KPI目標値）';
const MARGIN_TEXT_SOURCE = 'STAGE3の業績インパクトの本文（自由記述）';
const ADD_COST_SOURCE = 'STAGE3の業績インパクトの本文（自由記述・対象範囲は未記載）';

export function estimateProjectImpact(project: Json): ImpactEstimate {
  const a = (project.impactAssumptions ?? null) as Json | null;
  const rationale = typeof project.impactRationale === 'string' ? project.impactRationale : '';
  const kpis = Array.isArray(project.okrsV2) ? (project.okrsV2 as Json[]) : [];
  const role = typeof project.role === 'string' ? project.role : null;
  const stage3Revenue = num(project.impactRevenueMJPY);
  const stage3Op = num(project.impactOpIncomeMJPY);

  const target = num(a?.targetCustomers);
  const rate = num(a?.conversionRatePct);
  const deal = num(a?.averageDealMJPY);
  const hasRevenueInputs = target !== null && rate !== null && deal !== null;
  const cost = num(a?.currentCostMJPY);
  const reduction = num(a?.reductionRatePct);
  const hasCostInputs = cost !== null && reduction !== null;

  if (!hasRevenueInputs && !hasCostInputs) {
    return { status: 'NOT_CALCULATED', reason: 'この案件には、業績の計算前提（対象数・受注率・平均受注額、または現行コスト・削減率）が登録されていません' };
  }

  const rows: EstimateRow[] = [];
  const consistency: string[] = [];
  const warnings: string[] = [];

  let revenue: number | null = null;
  if (hasRevenueInputs) {
    revenue = round1((target as number) * ((rate as number) / 100) * (deal as number));
    const check: EstimateCheck =
      stage3Revenue === null ? 'UNCONFIRMED' : Math.abs(revenue - stage3Revenue) < SAME ? 'MATCHES_STAGE3' : 'MISMATCH';
    rows.push({
      label: '売上（試算）',
      valueMJPY: revenue,
      formula: `${target}社 × ${rate}% × ${deal}百万円 = ${fmt(revenue)}百万円`,
      source: '計算前提（対象数・受注率・平均受注額）',
      check,
      note: '対象区分（有償開発か量産か）と計上年度は、データに記載がなく未確認',
    });
    if (role === 'COST') {
      warnings.push('役割はCOSTだが、売上の前提（REVENUE用）も登録されている。売上の計上対象は未確認');
    }
  }

  const kpiMargin = kpis
    .filter((k) => typeof k.label === 'string' && k.label.includes(KPI_MARGIN_LABEL) && k.unit === '%')
    .map((k) => num(k.target))
    .find((v) => v !== null) ?? null;
  const textMargin = Number(/粗利率\s*(\d+(?:\.\d+)?)\s*%/.exec(rationale)?.[1] ?? NaN);
  const textMarginValue = Number.isFinite(textMargin) ? textMargin : null;
  const base = kpiMargin ?? textMarginValue;
  const baseSource = kpiMargin !== null ? MARGIN_KPI_SOURCE : MARGIN_TEXT_SOURCE;
  const alt = kpiMargin !== null && textMarginValue !== null && textMarginValue !== kpiMargin ? textMarginValue : null;
  if (kpiMargin !== null && textMarginValue !== null && kpiMargin !== textMarginValue) {
    warnings.push(`粗利率が一致しない：${kpiMargin}%（KPI目標値）と${textMarginValue}%（本文）。どちらが正しいかは未確定のため、両方を並べて表示する`);
  }

  const addCost = Number(/追加費用\s*(\d+(?:\.\d+)?)\s*百万円/.exec(rationale)?.[1] ?? NaN);
  const addCostValue = Number.isFinite(addCost) ? addCost : null;
  const textOp = Number(/営業利益増分を?\s*(\d+(?:\.\d+)?)\s*百万円/.exec(rationale)?.[1] ?? NaN);
  const textOpValue = Number.isFinite(textOp) ? textOp : null;

  const marginRow = (m: number | null, source: string, label: string): EstimateRow | null => {
    if (revenue === null) return null;
    if (m === null) {
      return { label, valueMJPY: null, formula: null, source, check: 'NOT_CALCULATED', note: '粗利率の前提が無いため算定しない' };
    }
    const gp = round1(revenue * (m / 100));
    return {
      label,
      valueMJPY: gp,
      formula: `${fmt(revenue)}百万円 × ${m}% = ${fmt(gp)}百万円`,
      source,
      check: 'UNCONFIRMED',
      note: '粗利益（売上 − 直接原価）。営業利益ではない',
    };
  };
  const opRow = (gp: EstimateRow | null, label: string): EstimateRow | null => {
    if (gp === null) return null;
    if (gp.valueMJPY === null || addCostValue === null) {
      return {
        label,
        valueMJPY: null,
        formula: null,
        source: ADD_COST_SOURCE,
        check: 'NOT_CALCULATED',
        note: '追加費用の記載が無いため、営業利益は算定しない',
      };
    }
    const op = round1(gp.valueMJPY - addCostValue);
    const check: EstimateCheck = stage3Op === null ? 'UNCONFIRMED' : Math.abs(op - stage3Op) < SAME ? 'MATCHES_STAGE3' : 'MISMATCH';
    return {
      label,
      valueMJPY: op,
      formula: `${fmt(gp.valueMJPY)}百万円 − ${fmt(addCostValue)}百万円（追加費用） = ${fmt(op)}百万円`,
      source: `${gp.source} と ${ADD_COST_SOURCE}`,
      check,
      note: '追加費用の対象が粗利率の原価に含まれていないかは未確認（含まれていれば二重に控除になる）',
    };
  };

  const gpBase = marginRow(base, baseSource, base === null ? '粗利益（試算）' : `粗利益（試算・前提 粗利率${base}%）`);
  const gpAlt = alt === null ? null : marginRow(alt, MARGIN_TEXT_SOURCE, `粗利益（比較・前提 粗利率${alt}%）`);
  for (const r of [gpBase, gpAlt]) if (r) rows.push(r);
  for (const r of [opRow(gpBase, '営業利益（売上経由・基本）'), opRow(gpAlt, '営業利益（売上経由・比較）')]) {
    if (r) rows.push(r);
  }

  if (hasCostInputs) {
    const value = round1((cost as number) * ((reduction as number) / 100));
    const check: EstimateCheck = stage3Op === null ? 'UNCONFIRMED' : Math.abs(value - stage3Op) < SAME ? 'MATCHES_STAGE3' : 'MISMATCH';
    rows.push({
      label: '営業利益（費用削減）',
      valueMJPY: value,
      formula: `${cost}百万円（現行コスト） × ${reduction}%（削減率） = ${fmt(value)}百万円`,
      source: '計算前提（現行コスト・削減率）',
      check,
      note: '費用削減による効果。売上経由の営業利益とは別の効果のため、合算しない。現行コストの出所は未確認',
    });
    if (stage3Op !== null && check === 'MATCHES_STAGE3') {
      consistency.push(`STAGE3の営業利益${fmt(stage3Op)}百万円は、費用削減の式（現行コスト×削減率）と一致する`);
    }
  }

  if (stage3Op !== null && textOpValue !== null && textOpValue !== stage3Op) {
    consistency.push(`本文の営業利益増分${fmt(textOpValue)}百万円と、STAGE3の営業利益${fmt(stage3Op)}百万円は一致しない（別の式による値のため、意味が異なる）`);
  }
  const opAlt = rows.find((r) => r.label === '営業利益（売上経由・比較）')?.valueMJPY ?? null;
  if (opAlt !== null && textOpValue !== null && Math.abs(opAlt - textOpValue) < SAME) {
    consistency.push(`本文の営業利益増分${fmt(textOpValue)}百万円は、粗利率${alt}%で売上経由の計算をした値と一致する（本文の中では整合）`);
  }
  warnings.push('計上年度は未確認のため、年度別の業績としては表示しない');

  return {
    status: 'CALCULATED',
    stage3Targets: { revenueMJPY: stage3Revenue, opIncomeMJPY: stage3Op },
    rows,
    consistency,
    warnings,
  };
}
