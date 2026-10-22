'use client';

import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { CfBasis, CfValue, CfYear, CashFlowPlan } from '@/utils/stage6/cashflow';
import { MILLION, parseNumber } from './financePlanForm';
import { amountScaleWarning, ratioScaleWarning } from './financePlanStatus';

export { MILLION, parseNumber, toCashFlowAssumptions } from './financePlanForm';

const MIN_CASH_HELP = '正式名称は最低必要現預金です。返済を反映した後の期末現預金がこの額を下回ると、資金不足と判定します。';
const AR_HELP = '正式名称は売上債権比率（売上高に対する売上債権の割合）です。売上高が増えたときの資金需要の推計に使用します。';
const INVENTORY_HELP = '正式名称は棚卸資産比率（売上高に対する棚卸資産の割合）です。必要な運転資金の推計に使用します。';
const AP_HELP = '正式名称は仕入債務比率（売上高に対する仕入債務の割合）です。支払時期による運転資金への影響を推計します。';


export type CashFlowForm = {
  minCash: string;
  taxRate: string;
  depreciation: string;
  ar: string;
  inventory: string;
  ap: string;
  targetRevenue: string;
  targetOperatingIncome: string;
  targetYear: string;
};

export const EMPTY_CASHFLOW_FORM: CashFlowForm = {
  minCash: '',
  taxRate: '',
  depreciation: '',
  ar: '',
  inventory: '',
  ap: '',
  targetRevenue: '',
  targetOperatingIncome: '',
  targetYear: '',
};

export const BASIS_LABEL: Record<CfBasis, string> = {
  ACTUAL: '実績',
  ESTIMATE: '推計',
  USER: '利用者指定',
  REGISTERED: 'STAGE4登録',
  HELD: '保留',
};

export const BASIS_CLASS: Record<CfBasis, string> = {
  ACTUAL: 'bg-slate-100 text-slate-700',
  ESTIMATE: 'bg-sky-50 text-sky-700',
  USER: 'bg-violet-50 text-violet-700',
  REGISTERED: 'bg-emerald-50 text-emerald-700',
  HELD: 'bg-amber-50 text-amber-800',
};

export function fmtMil(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '保留';
  return (value / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

export function fmtPct(v: number | null) {
  return v === null ? '-' : `${(v * 100).toFixed(1)}%`;
}

export function BasisBadge({ basis }: { basis: CfBasis }) {
  return (
    <span className={`mt-0.5 inline-block rounded px-1 text-[10px] font-semibold ${BASIS_CLASS[basis]}`}>
      {BASIS_LABEL[basis]}
    </span>
  );
}

export function Cell({ cell }: { cell: CfValue | undefined }) {
  if (!cell) return <td className="px-2 py-1.5 text-right text-slate-400">-</td>;
  const held = cell.value === null;
  const notApplicable = held && cell.basis === 'ACTUAL';
  return (
    <td className="px-2 py-1.5 text-right align-top" title={cell.note ?? ''}>
      <div className={held ? 'text-amber-700' : 'font-medium text-slate-900'}>
        {notApplicable ? '対象外' : fmtMil(cell.value)}
      </div>
      <BasisBadge basis={cell.basis} />
    </td>
  );
}

export function TermLabel({ primary, term, className = '' }: { primary: string; term?: string; className?: string }) {
  return (
    <span className={`block ${className}`}>
      <span className="block">{primary}</span>
      {term && <span className="block text-[11px] font-normal leading-snug text-slate-500">{term}</span>}
    </span>
  );
}

export function Row({
  label,
  term,
  years,
  pick,
  strong,
}: {
  label: string;
  term?: string;
  years: CfYear[];
  pick: (y: CfYear) => CfValue;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'bg-slate-50/70' : ''}>
      <td className={`px-2 py-1.5 ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        <TermLabel primary={label} term={term} />
      </td>
      {years.map((y) => (
        <Cell key={y.year} cell={pick(y)} />
      ))}
    </tr>
  );
}

export function RatioCell({ label, term, cell }: { label: string; term?: string; cell: CfValue }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <TermLabel primary={label} term={term} className="text-slate-600" />
      <div className={cell.value === null ? 'text-amber-700' : 'font-semibold text-slate-900'}>
        {cell.value === null ? '保留' : fmtPct(cell.value)}
      </div>
      <BasisBadge basis={cell.basis} />
    </div>
  );
}

const signedMil = (v: number) => `${v > 0 ? '＋' : v < 0 ? '△' : ''}${fmtMil(Math.abs(v))}`;

function WorkingCapitalBreakdownPanel({ plan }: { plan: CashFlowPlan }) {
  const year = plan.years.find((y) => y.kind === 'FORECAST');
  const b = year?.workingCapitalBreakdown;
  if (!year || !b || year.workingCapitalChange.value === null) {
    return (
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <h3 className="font-semibold text-slate-900">初年度に追加で必要な運転資金</h3>
        <p className="mt-2 text-xs text-amber-800">運転資金の内訳を計算するための情報が不足しています。</p>
      </section>
    );
  }
  const total = year.workingCapitalChange.value;
  const salesLabel = b.salesEffectYen < 0 ? '売上の減少による影響' : '売上の増加による影響';
  const items = [
    { key: 'ar', primary: 'お客様からの回収待ち', term: '売掛金', data: b.items.ar },
    { key: 'inventory', primary: '在庫', term: '棚卸資産', data: b.items.inventory },
    { key: 'ap', primary: '仕入先への支払い', term: '買掛金（増えると資金が増えるため△で表示）', data: b.items.ap },
  ];

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h3 className="font-semibold text-slate-900">初年度に追加で必要な運転資金</h3>
      <p className="text-xs text-slate-500">{year.year}年度</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">
        {signedMil(total)}
        <span className="ml-1 text-sm font-normal text-slate-600">百万円</span>
      </p>
      {total < 0 && <p className="text-xs font-semibold text-emerald-700">運転資金の減少（資金が増える方向）</p>}

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-slate-700">{salesLabel}</dt>
          <dd className="whitespace-nowrap font-medium text-slate-900">{signedMil(b.salesEffectYen)}百万円</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-slate-700">回収・在庫・支払条件の変更による影響</dt>
          <dd className="whitespace-nowrap font-medium text-slate-900">{signedMil(b.ratioEffectYen)}百万円</dd>
        </div>
      </dl>

      {b.ratioChanged && (
        <p className="mt-3 text-xs text-slate-700">回収・在庫・支払条件の変更は、計画初年度にまとめて反映されています。</p>
      )}
      {b.salesGrowthFromTargetYear && (
        <p className="mt-1 text-xs text-slate-700">売上目標を初年度に設定しているため、売上増加による影響が初年度に反映されています。</p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        {plan.baseYear}年度末の実績と、入力した条件との差額です。条件を据え置くと、条件変更による影響は0になります。
      </p>

      <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">詳しい内訳を見る</summary>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.key} className="min-w-0 rounded-lg border border-slate-200 bg-white p-2">
              <TermLabel primary={item.primary} term={item.term} className="text-slate-900" />
              <dl className="mt-2 space-y-0.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">売上増減による影響</dt>
                  <dd className="whitespace-nowrap">{signedMil(item.data.salesEffectYen)}百万円</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">比率変更による影響</dt>
                  <dd className="whitespace-nowrap">{signedMil(item.data.ratioEffectYen)}百万円</dd>
                </div>
                <div className="flex justify-between gap-2 font-semibold">
                  <dt>合計</dt>
                  <dd className="whitespace-nowrap">{signedMil(item.data.salesEffectYen + item.data.ratioEffectYen)}百万円</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] leading-snug text-slate-500">
                実績比率 {fmtPct(item.data.baseRatio)} → 計画比率 {fmtPct(item.data.planRatio)}
              </p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

type PanelProps = {
  plan: CashFlowPlan;
  form: CashFlowForm;
  setForm: Dispatch<SetStateAction<CashFlowForm>>;
};

export function CashFlowPanel({ plan, form, setForm }: PanelProps) {
  const setField = (key: keyof CashFlowForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const years = plan.years;
  const baseRevenueYen = years.find((y) => y.kind === 'ACTUAL' && y.year === plan.baseYear)?.revenue.value ?? null;
  const ratioBase = (cell: CfValue) => (cell.value === null ? null : cell.value * 100);
  const millionWarning = (raw: string) =>
    amountScaleWarning({ valueMillionYen: parseNumber(raw), baseRevenueYen });
  const ratioWarning = (raw: string, cell: CfValue) =>
    ratioScaleWarning({ enteredPercent: parseNumber(raw), basePercent: ratioBase(cell) });

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="font-semibold text-slate-600">財務実績の基準年度</div>
          <div className="mt-1 text-sm text-slate-900">
            PL：{plan.baseYear ?? '未確認'} ／ BS：{plan.bsBaseYear ?? '未確認'}
          </div>
          {plan.yearMismatch && <div className="mt-1 text-amber-700">PLとBSの基準年度が異なります（推計を保留）</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="font-semibold text-slate-600">税率</div>
          <div className="mt-1 text-sm text-slate-900">
            {plan.taxRate.value === null ? '保留' : fmtPct(plan.taxRate.value)}
          </div>
          <div className="text-slate-500">{plan.taxRate.note}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="font-semibold text-slate-600">今後の業績の見通し</div>
          <div className="mt-1 text-sm text-slate-900">{plan.scenario.note}</div>
        </div>
      </div>

      {plan.unitSuspects.length > 0 && (
        <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
          金額の桁から単位不一致が疑われる項目があります（計算には使用しています）。ご確認ください：{plan.unitSuspects.join('、')}
        </p>
      )}

      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">推計前提（試算条件）</summary>
        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-5 text-sm sm:grid-cols-2 md:grid-cols-3">
          <Field
            label="手元に残しておきたいお金"
            term="最低必要現預金"
            value={form.minCash}
            onChange={setField('minCash')}
            unit="百万円"
            help={MIN_CASH_HELP}
            example="入力例：100＝1億円、1,000＝10億円"
            warning={millionWarning(form.minCash)}
          />
          <Field
            label="税率"
            value={form.taxRate}
            onChange={setField('taxRate')}
            unit="%"
            help="空欄の場合は基準年度の実績から推計します。"
          />
          <Field
            label="減価償却費"
            value={form.depreciation}
            onChange={setField('depreciation')}
            unit="百万円"
            help="空欄の場合は基準年度の値を据え置きます。"
            warning={millionWarning(form.depreciation)}
          />
          <Field
            label="売上に対する未回収代金の割合"
            term="売上債権比率"
            value={form.ar}
            onChange={setField('ar')}
            unit="%"
            help={`${AR_HELP}空欄の場合は基準年度の比率を使います。`}
            warning={ratioWarning(form.ar, plan.workingCapitalRatios.ar)}
          />
          <Field
            label="売上に対する在庫の割合"
            term="棚卸資産比率"
            value={form.inventory}
            onChange={setField('inventory')}
            unit="%"
            help={`${INVENTORY_HELP}空欄の場合は基準年度の比率を使います。`}
            warning={ratioWarning(form.inventory, plan.workingCapitalRatios.inventory)}
          />
          <Field
            label="売上に対する仕入先への未払額の割合"
            term="仕入債務比率"
            value={form.ap}
            onChange={setField('ap')}
            unit="%"
            help={`${AP_HELP}空欄の場合は基準年度の比率を使います。`}
            warning={ratioWarning(form.ap, plan.workingCapitalRatios.ap)}
          />
          <Field
            label="目標売上"
            term="今後の業績の見通し（推計シナリオ）"
            value={form.targetRevenue}
            onChange={setField('targetRevenue')}
            unit="百万円"
            warning={millionWarning(form.targetRevenue)}
          />
          <Field
            label="目標営業利益"
            term="今後の業績の見通し（推計シナリオ）"
            value={form.targetOperatingIncome}
            onChange={setField('targetOperatingIncome')}
            unit="百万円"
            warning={millionWarning(form.targetOperatingIncome)}
          />
          <Field
            label="目標年度"
            term="今後の業績の見通し（推計シナリオ）"
            value={form.targetYear}
            onChange={setField('targetYear')}
            unit="年"
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          売上・営業利益の目標を入れると、基準年度から目標年度まで直線的に推計します。これは今後の業績の見通しを試算したものであり、会社が承認した計画値ではありません。
        </p>
      </details>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">項目（百万円）</th>
              {years.map((y) => (
                <th key={y.year} className="px-2 py-2 text-right font-semibold">
                  {y.year}年{y.kind === 'ACTUAL' ? '（実績）' : '（推計）'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <Row label="売上高" years={years} pick={(y) => y.revenue} />
            <Row label="営業利益" years={years} pick={(y) => y.operatingIncome} />
            <Row label="支払利息" term="借入計画・据置の利息" years={years} pick={(y) => y.interest} />
            <Row label="税引後利益（推計）" years={years} pick={(y) => y.netIncome} />
            <Row label="減価償却費" years={years} pick={(y) => y.depreciation} />
            <Row label="事業を回すために必要なお金" term="運転資金の残高" years={years} pick={(y) => y.workingCapital} />
            <Row label="追加で必要な運転資金" term="運転資金増加額（△は減少）" years={years} pick={(y) => y.workingCapitalChange} />
            <Row label="事業から生まれるお金" term="営業CF" years={years} pick={(y) => y.operatingCf} strong />
            <Row label="投資によるお金の増減" term="投資CF・設備などへの投資" years={years} pick={(y) => y.investingCf} />
            <Row label="事業と投資を合わせたお金の増減" term="FCF" years={years} pick={(y) => y.fcf} strong />
            <Row label="期首現預金" years={years} pick={(y) => y.openingCash} />
            <Row label="期末現預金（借入反映前）" years={years} pick={(y) => y.closingCashBeforeFinancing} strong />
            <Row label="借入・返済などによるお金の増減" term="財務CF（新規借入−元本返済−配当）" years={years} pick={(y) => y.financingCf} strong />
            <Row label="期末現預金（借入反映後）" years={years} pick={(y) => y.closingCashAfterFinancing} strong />
            <Row label="手元に残しておきたいお金" term="最低必要現預金" years={years} pick={(y) => y.minCash} />
            <Row label="不足額（借入反映前・参考）" years={years} pick={(y) => y.shortfall} />
            <Row label="不足額（借入反映後）" years={years} pick={(y) => y.postShortfall} strong />
            <tr>
              <td className="px-2 py-1.5 text-slate-500">
                <TermLabel primary="事業運営にかかる費用" term="OPEX・営業利益計画に含まれるため控除していない" />
              </td>
              {years.map((y) => (
                <td key={y.year} className="px-2 py-1.5 text-right text-slate-500">
                  {fmtMil(y.kind === 'FORECAST' ? y.opexRegistered : null)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1.5 text-slate-500">
                <TermLabel primary="その他の支出" term="OTHER・内容確認が必要で未計上" />
              </td>
              {years.map((y) => (
                <td key={y.year} className="px-2 py-1.5 text-right text-slate-500">
                  {fmtMil(y.kind === 'FORECAST' ? y.otherRegistered : null)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <WorkingCapitalBreakdownPanel plan={plan} />

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <h3 className="text-sm font-semibold text-slate-900">評価保留・未確認事項（キャッシュフロー）</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
          {plan.globalHolds.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        {years.some((y) => y.holds.length > 0) && (
          <div className="mt-3 space-y-1 text-xs text-amber-900">
            {years
              .filter((y) => y.holds.length > 0)
              .map((y) => (
                <div key={y.year}>
                  <span className="font-semibold">{y.year}年：</span>
                  {y.holds.join('、')}
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <RatioCell label="売上に対する未回収代金" term="売上債権" cell={plan.workingCapitalRatios.ar} />
        <RatioCell label="売上に対する在庫" term="棚卸資産" cell={plan.workingCapitalRatios.inventory} />
        <RatioCell label="売上に対する仕入先への未払額" term="仕入債務" cell={plan.workingCapitalRatios.ap} />
      </div>
    </div>
  );
}

function HelpToggle({ text }: { text: string }) {
  return (
    <details className="relative">
      <summary
        aria-label="説明を表示"
        className="flex h-5 w-5 shrink-0 cursor-pointer list-none items-center justify-center rounded-full border border-slate-400 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
      >
        ?
      </summary>
      <div className="absolute left-0 top-6 z-10 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700 shadow-md">
        {text}
      </div>
    </details>
  );
}

function Field({
  label,
  term,
  value,
  onChange,
  unit,
  help,
  example,
  warning,
}: {
  label: string;
  term?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  unit?: string;
  help?: string;
  example?: string;
  warning?: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1.5">
        <TermLabel primary={label} term={term} className="min-w-0 font-medium text-slate-800" />
        {help && <div className="mt-0.5"><HelpToggle text={help} /></div>}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-900"
          value={value}
          onChange={onChange}
          inputMode="decimal"
        />
        {unit && <span className="shrink-0 whitespace-nowrap text-sm text-slate-600">{unit}</span>}
      </div>
      {example && <p className="mt-1 text-xs text-slate-500">{example}</p>}
      {warning && (
        <p role="status" className="mt-1 text-xs font-medium text-amber-800">
          {warning}
        </p>
      )}
    </div>
  );
}
