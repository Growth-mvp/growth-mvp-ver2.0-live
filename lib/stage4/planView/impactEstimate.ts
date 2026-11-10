/* 第5章の参考試算。計算はプログラムで行い、AIには算術をさせない。
 * 数値の出所は、利用者の修正 > STAGE3の登録済みの前提 > AIの仮説（basis HYPOTHESIS）の順に決める。
 * 試算は確定値ではない。STAGE6の経路A・経路Bには書き込まず、既存の数値も変えない。
 * STAGE3の営業利益（費用削減の式）は、この案件の利益貢献として対応を確認できないため使わない。 */

type Json = Record<string, unknown>;

export type ParamKey = 'customers' | 'rate' | 'deal' | 'grossMarginPct' | 'addCostMJPY' | 'investmentMJPY' | 'startYear' | 'endYear';
export type ParamSource = 'USER' | 'STAGE3' | 'STAGE3_TEXT' | 'AI_HYPOTHESIS' | 'MISSING';

export const IMPACT_EDIT_PREFIX = 'impact:';

export const PARAM_LABEL: Record<ParamKey, { label: string; unit: string }> = {
  customers: { label: '対象の顧客数', unit: '社' },
  rate: { label: '受注率', unit: '%' },
  deal: { label: '平均受注額', unit: '百万円' },
  grossMarginPct: { label: '粗利率', unit: '%' },
  addCostMJPY: { label: '追加費用', unit: '百万円' },
  investmentMJPY: { label: '投資額', unit: '百万円' },
  startYear: { label: '計上開始年度', unit: '年度' },
  endYear: { label: '計上終了年度', unit: '年度' },
};

export const SOURCE_LABEL: Record<ParamSource, string> = {
  USER: '利用者の修正',
  STAGE3: 'STAGE3の登録値',
  STAGE3_TEXT: 'STAGE3の本文（自由記述）',
  AI_HYPOTHESIS: 'AIの仮説（未確認）',
  MISSING: '未入力',
};

export type ParamView = { key: ParamKey; label: string; unit: string; value: number | null; source: ParamSource };

export type EstimateRow = {
  label: string;
  valueMJPY: number | null;
  valueText: string | null;
  formula: string | null;
  source: string;
  check: 'MATCHES_STAGE3' | 'UNCONFIRMED' | 'NOT_CALCULATED';
  note: string | null;
};

export type ImpactEstimate =
  | { status: 'NOT_CALCULATED'; reason: string; params: ParamView[] }
  | {
      status: 'CALCULATED';
      params: ParamView[];
      stage3RevenueMJPY: number | null;
      rows: EstimateRow[];
      warnings: string[];
    };

/* 計算前提の仮説（AIの算定入力のうち basis が HYPOTHESIS のもの）。キーは計算の項目に対応する */
export type HypothesisValues = Partial<Record<ParamKey, number>>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const fmt = (v: number): string => String(round1(v));
const SAME = 0.05;
const KPI_MARGIN_LABEL = '用途別案件の粗利率';

const textNumber = (text: string, re: RegExp): number | null => {
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

/* AIの算定入力（finance items の inputs のうち HYPOTHESIS）を、試算の項目へ対応づける */
export function hypothesisOf(financeItems: unknown): HypothesisValues {
  const out: HypothesisValues = {};
  if (!Array.isArray(financeItems)) return out;
  for (const item of financeItems as Json[]) {
    const inputs = Array.isArray(item.inputs) ? (item.inputs as Json[]) : [];
    for (const input of inputs) {
      const value = num(input.value);
      if (value === null || input.basis !== 'HYPOTHESIS') continue;
      const role = input.role;
      const label = typeof input.label === 'string' ? input.label : '';
      if (role === 'MEETINGS' && out.customers === undefined) out.customers = value;
      else if ((role === 'WIN_RATE' || role === 'CONVERSION_RATE') && out.rate === undefined) out.rate = value;
      else if (role === 'AVG_DEAL' && out.deal === undefined) out.deal = value;
      else if (role === 'COST_RATE' && out.grossMarginPct === undefined && value <= 100) out.grossMarginPct = 100 - value;
      else if (role === 'OTHER' && /追加費用/.test(label) && out.addCostMJPY === undefined) out.addCostMJPY = value;
      else if (role === 'OTHER' && /投資/.test(label) && out.investmentMJPY === undefined) out.investmentMJPY = value;
    }
  }
  return out;
}

/* 1つの項目の出所を決める：利用者の修正 → STAGE3の登録値 → STAGE3の本文 → AIの仮説 */
function pick(
  edit: number | null,
  stage3: number | null,
  text: number | null,
  hyp: number | null
): { value: number | null; source: ParamSource } {
  if (edit !== null) return { value: edit, source: 'USER' };
  if (stage3 !== null) return { value: stage3, source: 'STAGE3' };
  if (text !== null) return { value: text, source: 'STAGE3_TEXT' };
  if (hyp !== null) return { value: hyp, source: 'AI_HYPOTHESIS' };
  return { value: null, source: 'MISSING' };
}

export function estimateProjectImpact(
  project: Json,
  inputs: { edits?: Json; hypothesis?: HypothesisValues } = {}
): ImpactEstimate {
  const edits = inputs.edits ?? {};
  const hyp = inputs.hypothesis ?? {};
  const a = (project.impactAssumptions ?? null) as Json | null;
  const rationale = typeof project.impactRationale === 'string' ? project.impactRationale : '';
  const kpis = Array.isArray(project.okrsV2) ? (project.okrsV2 as Json[]) : [];
  const role = typeof project.role === 'string' ? project.role : null;
  const stage3Revenue = num(project.impactRevenueMJPY);
  const e = (k: ParamKey) => num(edits[`${IMPACT_EDIT_PREFIX}${k}`]);

  const kpiMargin = kpis
    .filter((k) => typeof k.label === 'string' && k.label.includes(KPI_MARGIN_LABEL) && k.unit === '%')
    .map((k) => num(k.target))
    .find((v) => v !== null) ?? null;
  const textMargin = textNumber(rationale, /粗利率\s*(\d+(?:\.\d+)?)\s*%/);
  const textAddCost = textNumber(rationale, /追加費用\s*(\d+(?:\.\d+)?)\s*百万円/);
  const textInvest = textNumber(rationale, /投資を?\s*(\d+(?:\.\d+)?)\s*百万円/);

  const picks = {
    customers: pick(e('customers'), num(a?.targetCustomers), null, hyp.customers ?? null),
    rate: pick(e('rate'), num(a?.conversionRatePct), null, hyp.rate ?? null),
    deal: pick(e('deal'), num(a?.averageDealMJPY), null, hyp.deal ?? null),
    grossMarginPct: pick(e('grossMarginPct'), kpiMargin, textMargin, hyp.grossMarginPct ?? null),
    addCostMJPY: pick(e('addCostMJPY'), null, textAddCost, hyp.addCostMJPY ?? null),
    investmentMJPY: pick(e('investmentMJPY'), null, textInvest, hyp.investmentMJPY ?? null),
    startYear: { value: e('startYear'), source: (e('startYear') !== null ? 'USER' : 'MISSING') as ParamSource },
    endYear: { value: e('endYear'), source: (e('endYear') !== null ? 'USER' : 'MISSING') as ParamSource },
  };
  const params: ParamView[] = (Object.keys(PARAM_LABEL) as ParamKey[]).map((k) => ({
    key: k,
    ...PARAM_LABEL[k],
    value: picks[k].value,
    source: picks[k].source,
  }));

  const target = picks.customers.value;
  const rate = picks.rate.value;
  const deal = picks.deal.value;
  if (target === null || rate === null || deal === null) {
    return {
      status: 'NOT_CALCULATED',
      reason: '売上の計算に必要な前提（対象の顧客数・受注率・平均受注額）が、まだそろっていません。修正欄から入力できます',
      params,
    };
  }

  const rows: EstimateRow[] = [];
  const warnings: string[] = [];
  const revenue = round1(target * (rate / 100) * deal);
  const allFromStage3 = [picks.customers, picks.rate, picks.deal].every((p) => p.source === 'STAGE3');
  const revenueMatches = allFromStage3 && stage3Revenue !== null && Math.abs(revenue - stage3Revenue) < SAME;
  const sourceText = `対象の顧客数：${SOURCE_LABEL[picks.customers.source]}、受注率：${SOURCE_LABEL[picks.rate.source]}、平均受注額：${SOURCE_LABEL[picks.deal.source]}`;
  rows.push({
    label: '売上（参考試算）',
    valueMJPY: revenue,
    valueText: null,
    formula: `${target}社 × ${rate}% × ${deal}百万円 = ${fmt(revenue)}百万円`,
    source: sourceText,
    check: revenueMatches ? 'MATCHES_STAGE3' : 'UNCONFIRMED',
    note: revenueMatches
      ? 'STAGE3の売上増分の目標と一致。売上の対象区分（有償開発か量産か）は未確認'
      : '売上の対象区分（有償開発か量産か）は未確認',
  });
  if (role === 'COST' && (num(a?.targetCustomers) !== null)) {
    warnings.push('役割はCOSTだが、売上の前提（REVENUE用）も登録されている。売上の計上対象は未確認');
  }
  warnings.push('売上の対象区分（有償開発か量産か）は未確認');
  if (stage3Revenue !== null && !revenueMatches && allFromStage3 === false) {
    warnings.push(`売上の参考試算（${fmt(revenue)}百万円）は、STAGE3の売上目標（${fmt(stage3Revenue)}百万円）と前提の出所が異なるため、一致とは扱わない`);
  }

  const margin = picks.grossMarginPct.value;
  const marginSource = picks.grossMarginPct.source;
  const addCost = picks.addCostMJPY.value;
  const grossRows: EstimateRow[] = [];
  if (margin === null) {
    grossRows.push({ label: '粗利益（参考試算）', valueMJPY: null, valueText: null, formula: null, source: '粗利率の前提なし', check: 'NOT_CALCULATED', note: '粗利率の前提が無いため算定しない' });
  } else {
    const gp = round1(revenue * (margin / 100));
    grossRows.push({
      label: `粗利益（参考試算・粗利率${margin}%）`,
      valueMJPY: gp,
      valueText: null,
      formula: `${fmt(revenue)}百万円 × ${margin}% = ${fmt(gp)}百万円`,
      source: `粗利率：${marginSource === 'STAGE3' ? 'STAGE3のKPI目標値（用途別案件の粗利率）' : SOURCE_LABEL[marginSource]}`,
      check: 'UNCONFIRMED',
      note: '粗利益（売上 − 直接原価）。営業利益ではない',
    });
  }
  rows.push(...grossRows);

  const textMarginAlt = kpiMargin !== null && textMargin !== null && textMargin !== kpiMargin && e('grossMarginPct') === null ? textMargin : null;
  if (textMarginAlt !== null) {
    rows.push({
      label: `粗利益（比較値・粗利率${textMarginAlt}%）`,
      valueMJPY: round1(revenue * (textMarginAlt / 100)),
      valueText: null,
      formula: `${fmt(revenue)}百万円 × ${textMarginAlt}% = ${fmt(revenue * (textMarginAlt / 100))}百万円`,
      source: `粗利率：${SOURCE_LABEL.STAGE3_TEXT}`,
      check: 'UNCONFIRMED',
      note: 'KPI目標値とは別の入力値に基づく比較値。どちらが正しいかは未確定',
    });
    warnings.push(`粗利率が一致しない：${kpiMargin}%（KPI目標値）と${textMarginAlt}%（本文）。どちらが正しいかは確定していないため、両方を示す`);
  }

  if (margin !== null && addCost !== null) {
    const gp = round1(revenue * (margin / 100));
    const values = [round1(gp - addCost)];
    if (textMarginAlt !== null) values.push(round1(revenue * (textMarginAlt / 100) - addCost));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    rows.push({
      label: '営業利益の参考値（追加費用を差し引く）',
      valueMJPY: null,
      valueText: lo === hi ? fmt(lo) : `${fmt(lo)}〜${fmt(hi)}`,
      formula:
        textMarginAlt !== null
          ? `${fmt(gp)} − ${fmt(addCost)} = ${fmt(values[0])}（粗利率${margin}%） ／ ${fmt(revenue * (textMarginAlt / 100))} − ${fmt(addCost)} = ${fmt(values[1])}（粗利率${textMarginAlt}%）`
          : `${fmt(gp)} − ${fmt(addCost)} = ${fmt(values[0])}（粗利率${margin}%）`,
      source: `追加費用：${SOURCE_LABEL[picks.addCostMJPY.source]}`,
      check: 'UNCONFIRMED',
      note: '追加費用の対象範囲が未確認のため、確定した営業利益としては扱わない（粗利率の原価に含まれていれば二重控除になる）',
    });
  }

  const invest = picks.investmentMJPY.value;
  if (invest !== null) {
    rows.push({
      label: '投資支出（参考・利益とは別に扱う）',
      valueMJPY: invest,
      valueText: null,
      formula: `${invest}百万円`,
      source: `投資額：${SOURCE_LABEL[picks.investmentMJPY.source]}`,
      check: 'UNCONFIRMED',
      note: '利益の増加ではなく支出。回収の計算は行わない',
    });
  }

  const sy = picks.startYear.value;
  const ey = picks.endYear.value;
  rows.push({
    label: '計上期間',
    valueMJPY: null,
    valueText: sy !== null ? (ey !== null ? `${sy}年度〜${ey}年度` : `${sy}年度〜（終了年度は未入力）`) : '未確認',
    formula: null,
    source: `計上年度：${SOURCE_LABEL[picks.startYear.source]}`,
    check: 'UNCONFIRMED',
    note: sy === null ? '計上年度が未確認のため、年度別の業績としては表示しない' : null,
  });
  if (sy === null) warnings.push('計上年度は未確認のため、年度別の業績としては表示しない');
  if (num(a?.currentCostMJPY) !== null || num(a?.reductionRatePct) !== null || num(project.impactOpIncomeMJPY) !== null) {
    warnings.push('STAGE3の営業利益（費用削減）は、この案件の利益貢献として対応を確認できないため表示していない（別の施策の可能性があり、合算もしない）');
  }

  return { status: 'CALCULATED', params, stage3RevenueMJPY: stage3Revenue, rows, warnings };
}
