/* STAGE3に登録済みの業績の前提から、第5章の参考試算を作る。計算はプログラムで行い、AIには任せない。
 * 試算は確定値ではない。STAGE6の経路A・経路Bには書き込まず、既存の数値も変えない。
 * STAGE3の営業利益（費用削減の式）は、この案件の利益貢献として対応を確認できないため使わない。将来STAGE6へ接続するときも、本試算と合算しない。 */

type Json = Record<string, unknown>;

export type EstimateCheck = 'MATCHES_STAGE3' | 'UNCONFIRMED' | 'NOT_CALCULATED';

export type EstimateRow = {
  label: string;
  valueMJPY: number | null;
  valueText: string | null;
  formula: string | null;
  source: string;
  check: EstimateCheck;
  note: string | null;
};

export type ImpactEstimate =
  | { status: 'NOT_CALCULATED'; reason: string }
  | {
      status: 'CALCULATED';
      stage3RevenueMJPY: number | null;
      rows: EstimateRow[];
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

  const target = num(a?.targetCustomers);
  const rate = num(a?.conversionRatePct);
  const deal = num(a?.averageDealMJPY);
  if (target === null || rate === null || deal === null) {
    return { status: 'NOT_CALCULATED', reason: 'この案件には、売上の計算前提（対象数・受注率・平均受注額）が登録されていません' };
  }

  const rows: EstimateRow[] = [];
  const warnings: string[] = [];

  const revenue = round1(target * (rate / 100) * deal);
  rows.push({
    label: '売上（参考試算）',
    valueMJPY: revenue,
    valueText: null,
    formula: `${target}社 × ${rate}% × ${deal}百万円 = ${fmt(revenue)}百万円`,
    source: '計算前提（対象数・受注率・平均受注額）',
    check: stage3Revenue !== null && Math.abs(revenue - stage3Revenue) < SAME ? 'MATCHES_STAGE3' : 'UNCONFIRMED',
    note: stage3Revenue !== null && Math.abs(revenue - stage3Revenue) < SAME ? 'STAGE3の売上増分の目標と一致。ただし対象区分（有償開発か量産か）は未確認' : '対象区分（有償開発か量産か）は未確認',
  });
  if (role === 'COST') {
    warnings.push('役割はCOSTだが、売上の前提（REVENUE用）も登録されている。売上の計上対象は未確認');
  }

  const kpiMargin = kpis
    .filter((k) => typeof k.label === 'string' && k.label.includes(KPI_MARGIN_LABEL) && k.unit === '%')
    .map((k) => num(k.target))
    .find((v) => v !== null) ?? null;
  const textMarginRaw = Number(/粗利率\s*(\d+(?:\.\d+)?)\s*%/.exec(rationale)?.[1] ?? NaN);
  const textMargin = Number.isFinite(textMarginRaw) ? textMarginRaw : null;
  const base = kpiMargin ?? textMargin;
  const baseSource = kpiMargin !== null ? MARGIN_KPI_SOURCE : MARGIN_TEXT_SOURCE;
  const alt = kpiMargin !== null && textMargin !== null && textMargin !== kpiMargin ? textMargin : null;
  if (alt !== null) {
    warnings.push(`粗利率が一致しない：${kpiMargin}%（KPI目標値）と${alt}%（本文）。どちらが正しいかは確定していないため、両方を並べて示す`);
  }

  const addCostRaw = Number(/追加費用\s*(\d+(?:\.\d+)?)\s*百万円/.exec(rationale)?.[1] ?? NaN);
  const addCost = Number.isFinite(addCostRaw) ? addCostRaw : null;

  const grossRow = (m: number, source: string, label: string, note: string): EstimateRow => {
    const gp = round1(revenue * (m / 100));
    return {
      label,
      valueMJPY: gp,
      valueText: null,
      formula: `${fmt(revenue)}百万円 × ${m}% = ${fmt(gp)}百万円`,
      source,
      check: 'UNCONFIRMED',
      note,
    };
  };

  if (base === null) {
    rows.push({ label: '粗利益（参考試算）', valueMJPY: null, valueText: null, formula: null, source: '粗利率の前提なし', check: 'NOT_CALCULATED', note: '粗利率の前提が無いため算定しない' });
  } else {
    rows.push(grossRow(base, baseSource, `粗利益（参考試算・粗利率${base}%）`, '既存データから算出した参考試算（粗利益であり、営業利益ではない）'));
  }
  if (alt !== null) {
    rows.push(grossRow(alt, MARGIN_TEXT_SOURCE, `粗利益（比較値・粗利率${alt}%）`, '20%とは別の入力値に基づく比較値。どちらが正しいかは未確定'));
  }

  if (base !== null && addCost !== null) {
    const gpBase = round1(revenue * (base / 100));
    const values = [gpBase - addCost];
    if (alt !== null) values.push(round1(revenue * (alt / 100) - addCost));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    rows.push({
      label: '控除後の参考値（追加費用を差し引く）',
      valueMJPY: null,
      valueText: lo === hi ? fmt(lo) : `${fmt(lo)}〜${fmt(hi)}`,
      formula: values.length === 2
        ? `${fmt(gpBase)} − ${fmt(addCost)} = ${fmt(values[0])}（粗利率${base}%） ／ ${fmt(revenue * (alt! / 100))} − ${fmt(addCost)} = ${fmt(values[1])}（粗利率${alt}%）`
        : `${fmt(gpBase)} − ${fmt(addCost)} = ${fmt(values[0])}`,
      source: `${ADD_COST_SOURCE}`,
      check: 'UNCONFIRMED',
      note: '追加費用の対象範囲が未確認のため、確定した営業利益としては扱わない（粗利率の原価に含まれていれば二重控除になる）',
    });
  }

  warnings.push('売上の対象区分（有償開発か量産か）は未確認');
  warnings.push('計上年度は未確認のため、年度別の業績としては表示しない');
  if (stage3Revenue !== null && Math.abs(revenue - stage3Revenue) >= SAME) {
    warnings.push(`売上の参考試算（${fmt(revenue)}百万円）とSTAGE3の売上目標（${fmt(stage3Revenue)}百万円）が一致しない`);
  }
  if (num(a?.currentCostMJPY) !== null || num(a?.reductionRatePct) !== null || num(project.impactOpIncomeMJPY) !== null) {
    warnings.push('STAGE3の営業利益（費用削減）は、この案件の利益貢献として対応を確認できないため表示していない（別の施策の可能性があり、合算もしない）');
  }

  return {
    status: 'CALCULATED',
    stage3RevenueMJPY: stage3Revenue,
    rows,
    warnings,
  };
}
