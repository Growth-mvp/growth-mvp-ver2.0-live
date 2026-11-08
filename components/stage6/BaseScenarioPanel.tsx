'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { CashFlowPlan } from '@/utils/stage6/cashflow';
import { parseNumber, type BaseScenarioForm } from './financePlanForm';

type Planned = { revenueYen: number | null; operatingIncomeYen: number | null };

type Props = {
  years: number[];
  baseYear: number | null;
  baseRevenueYen: number | null;
  baseOperatingIncomeYen: number | null;
  planned: Record<number, Planned>;
  mode: CashFlowPlan['basisMode'];
  form: BaseScenarioForm;
  setForm: Dispatch<SetStateAction<BaseScenarioForm>>;
};

const MODE_LABEL: Record<CashFlowPlan['basisMode'], { label: string; tone: string }> = {
  FLAT: { label: '横ばい仮定（増減は未設定）', tone: 'bg-slate-100 text-slate-700' },
  BASE_SCENARIO: { label: '既存事業の年度別増減を反映中', tone: 'bg-emerald-100 text-emerald-800' },
  TARGET_PATH: { label: '経営目標の参考経路を表示中（既存事業の増減を起点にした参考値）', tone: 'bg-amber-100 text-amber-800' },
  FINANCE_OUTLOOK: { label: '統一財務試算の値を使用中', tone: 'bg-indigo-100 text-indigo-800' },
};

const mil = (yen: number | null) => (yen === null ? '—' : (yen / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }));

export function BaseScenarioPanel({ years, baseYear, baseRevenueYen, baseOperatingIncomeYen, planned, mode, form, setForm }: Props) {
  const update = (year: number, key: 'revenue' | 'operatingIncome', value: string) =>
    setForm((prev) => ({
      ...prev,
      [year]: { revenue: prev[year]?.revenue ?? '', operatingIncome: prev[year]?.operatingIncome ?? '', [key]: value },
    }));
  const invalid = (text: string | undefined) => text !== undefined && text.trim() !== '' && parseNumber(text) === null;
  const tag = MODE_LABEL[mode];

  return (
    <section aria-label="既存事業の見通し（ベースシナリオ）" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold text-slate-900">既存事業の見通し（ベースシナリオ）</h4>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tag.tone}`}>{tag.label}</span>
      </div>
      <p className="text-xs leading-relaxed text-slate-600 break-keep">
        増減は<strong>直近実績（{baseYear !== null ? `${baseYear}年度` : '基準年度'}）からの差額</strong>で、年度ごとに入力します（前年度からの差額ではありません）。
        直近実績：売上 {mil(baseRevenueYen)} 百万円 ／ 営業利益 {mil(baseOperatingIncomeYen)} 百万円。
        空欄は横ばいです。利用者が入力した値だけを使い、AIや利益率では推定しません。
        売上だけを入力し営業利益を空欄にすると、その年度の営業利益は未算定になります。
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className="px-2 py-1 text-left font-semibold">年度</th>
              <th className="px-2 py-1 text-left font-semibold">売上の増減（直近実績比・百万円）</th>
              <th className="px-2 py-1 text-left font-semibold">営業利益の増減（直近実績比・百万円）</th>
              <th className="px-2 py-1 text-right font-semibold">既存事業の売上（百万円）</th>
              <th className="px-2 py-1 text-right font-semibold">既存事業の営業利益（百万円）</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const entry = form[year];
              const p = planned[year];
              return (
                <tr key={year} className="border-b border-slate-100">
                  <td className="px-2 py-1 font-medium text-slate-800">{year}年度</td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${year}年度の売上の増減（百万円）`}
                      value={entry?.revenue ?? ''}
                      onChange={(e) => update(year, 'revenue', e.target.value)}
                      className={`w-28 rounded border px-2 py-1 ${invalid(entry?.revenue) ? 'border-rose-400' : 'border-slate-300'}`}
                      placeholder="横ばい"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${year}年度の営業利益の増減（百万円）`}
                      value={entry?.operatingIncome ?? ''}
                      onChange={(e) => update(year, 'operatingIncome', e.target.value)}
                      className={`w-28 rounded border px-2 py-1 ${invalid(entry?.operatingIncome) ? 'border-rose-400' : 'border-slate-300'}`}
                      placeholder="横ばい"
                    />
                  </td>
                  <td className="px-2 py-1 text-right text-slate-800">{mil(p?.revenueYen ?? null)}</td>
                  <td className="px-2 py-1 text-right text-slate-800">{mil(p?.operatingIncomeYen ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {Object.values(form).some((e) => invalid(e.revenue) || invalid(e.operatingIncome)) && (
        <p className="text-xs text-rose-700">数値として読めない入力があるため、その値は反映していません。</p>
      )}
    </section>
  );
}
