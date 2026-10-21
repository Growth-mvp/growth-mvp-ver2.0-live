'use client';

import type { Dispatch, SetStateAction } from 'react';
import {
  LOAN_CATEGORY_LABEL,
  type DebtSchedule,
  type DebtYear,
  type LoanCategory,
  type RepaymentMethod,
} from '@/utils/stage6/debt';
import type { CashFlowPlan, CfValue, CfYear } from '@/utils/stage6/cashflow';
import { BasisBadge, Row, TermLabel, fmtMil } from './CashFlowSection';

export type ExistingRowForm = {
  id: string;
  name: string;
  category: LoanCategory;
  balance: string;
  rate: string;
  schedule: Record<number, string>;
};

export type NewRowForm = {
  id: string;
  name: string;
  drawYear: string;
  drawMonth: string;
  amount: string;
  rate: string;
  term: string;
  grace: string;
  method: RepaymentMethod;
};

export type DebtForm = {
  existing: ExistingRowForm[];
  newLoans: NewRowForm[];
  dividends: Record<number, string>;
  seq: number;
};

export const EMPTY_DEBT_FORM: DebtForm = { existing: [], newLoans: [], dividends: {}, seq: 0 };

export function isDebtEntered(f: DebtForm): boolean {
  return (
    f.existing.length > 0 ||
    f.newLoans.length > 0 ||
    Object.values(f.dividends).some((v) => v.trim() !== '')
  );
}

export function fundingNeedOf(cfYears: CfYear[]) {
  const planned = cfYears.reduce<number | null>((acc, y) => (acc === null || y.draws.value === null ? null : acc + y.draws.value), 0);
  const needs = cfYears.map((y) => y.shortfall.value);
  const need = needs.length > 0 && needs.every((v) => v !== null) ? Math.max(...(needs as number[])) : null;
  const gap = need !== null && planned !== null ? need - planned : null;
  return { need, planned, gap };
}

const CATEGORY_OPTIONS: LoanCategory[] = ['BANK', 'BOND', 'LEASE', 'SHAREHOLDER', 'OTHER'];

type Props = {
  form: DebtForm;
  setForm: Dispatch<SetStateAction<DebtForm>>;
  forecastYears: number[];
  schedule: DebtSchedule;
  plan: CashFlowPlan;
};

const inputCls = 'mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs';

export function DebtPanel({ form, setForm, forecastYears, schedule, plan }: Props) {
  const seq = form.seq;
  const addExisting = () =>
    setForm((p) => ({
      ...p,
      seq: p.seq + 1,
      existing: [
        ...p.existing,
        { id: `e${seq}`, name: '', category: 'BANK', balance: '', rate: '', schedule: {} },
      ],
    }));
  const addNew = () =>
    setForm((p) => ({
      ...p,
      seq: p.seq + 1,
      newLoans: [
        ...p.newLoans,
        { id: `n${seq}`, name: '', drawYear: '', drawMonth: '', amount: '', rate: '', term: '', grace: '0', method: 'EQUAL_PRINCIPAL' },
      ],
    }));
  const updateExisting = (id: string, patch: Partial<ExistingRowForm>) =>
    setForm((p) => ({ ...p, existing: p.existing.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const updateExistingSchedule = (id: string, year: number, v: string) =>
    setForm((p) => ({
      ...p,
      existing: p.existing.map((r) => (r.id === id ? { ...r, schedule: { ...r.schedule, [year]: v } } : r)),
    }));
  const removeExisting = (id: string) => setForm((p) => ({ ...p, existing: p.existing.filter((r) => r.id !== id) }));
  const updateNew = (id: string, patch: Partial<NewRowForm>) =>
    setForm((p) => ({ ...p, newLoans: p.newLoans.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeNew = (id: string) => setForm((p) => ({ ...p, newLoans: p.newLoans.filter((r) => r.id !== id) }));
  const setDividend = (year: number, v: string) =>
    setForm((p) => ({ ...p, dividends: { ...p.dividends, [year]: v } }));

  const yearsOut = schedule.years;
  const cfYears: CfYear[] = plan.years.filter((y) => y.kind === 'FORECAST');
  const { need, planned, gap } = fundingNeedOf(cfYears);
  const rec = schedule.reconciliation;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        保存されていない試算条件です。借入・返済の入力は画面を再読み込み（F5）すると初期化されます。
      </div>

      {/* 1. 既存借入 */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">1. 既存借入残高と内訳（基準年度末）</h3>
          <button type="button" onClick={addExisting} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
            借入を追加
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="text-slate-500">STAGE1の有利子負債合計（基準年度BS）</div>
            <div className="mt-1 text-sm font-semibold">{fmtMil(rec.stage1InterestBearingDebtYen)} 百万円</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="text-slate-500">入力した内訳の合計</div>
            <div className="mt-1 text-sm font-semibold">{fmtMil(rec.statedTotalYen)} 百万円</div>
          </div>
          <div
            className={`rounded-lg border p-3 text-xs ${
              rec.status === 'DIFFERENT' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="text-slate-500">差額（内訳 − STAGE1）</div>
            <div className="mt-1 text-sm font-semibold">
              {rec.status === 'NOT_ENTERED' ? '未照合' : `${fmtMil(rec.differenceYen)} 百万円`}
            </div>
            <div className="mt-1 text-slate-600">
              {rec.status === 'MATCH' && '内訳とSTAGE1の合計が一致しています'}
              {rec.status === 'DIFFERENT' && '一致していません。差額を確認してください（自動補正はしていません）'}
              {rec.status === 'NOT_ENTERED' && '内訳と合計を入力すると照合します'}
            </div>
          </div>
        </div>

        {form.existing.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
            借入の内訳が未入力です。内訳が入るまで既存借入の返済・利息は推定しません（評価保留）。
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1 text-left">借入名称</th>
                  <th className="px-2 py-1 text-left">区分</th>
                  <th className="px-2 py-1 text-left">基準年度末残高（百万円）</th>
                  <th className="px-2 py-1 text-left">金利（%）</th>
                  {forecastYears.map((y) => (
                    <th key={y} className="px-2 py-1 text-left">{y}年 元本返済予定（百万円）</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.existing.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-1"><input className={inputCls} value={r.name} onChange={(e) => updateExisting(r.id, { name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className={inputCls} value={r.category} onChange={(e) => updateExisting(r.id, { category: e.target.value as LoanCategory })}>
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>{LOAN_CATEGORY_LABEL[c]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.balance} inputMode="decimal" onChange={(e) => updateExisting(r.id, { balance: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.rate} inputMode="decimal" onChange={(e) => updateExisting(r.id, { rate: e.target.value })} /></td>
                    {forecastYears.map((y) => (
                      <td key={y} className="px-2 py-1">
                        <input className={inputCls} value={r.schedule[y] ?? ''} inputMode="decimal" onChange={(e) => updateExistingSchedule(r.id, y, e.target.value)} />
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      <button type="button" onClick={() => removeExisting(r.id)} className="text-rose-600 hover:underline">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-500">
              元本返済予定は利用者が入力した額のみを使います。空欄の年度は評価保留になり、0とはみなしません。
            </p>
          </div>
        )}
      </section>

      {/* 2. 新規借入 */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">2. 新規借入計画</h3>
          <button type="button" onClick={addNew} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
            新規借入を追加
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="text-slate-500">必要資金額（借入反映前の年度別不足額の最大）</div>
            <div className="mt-1 text-sm font-semibold">{fmtMil(need)} 百万円</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="text-slate-500">新規借入予定額（合計）</div>
            <div className="mt-1 text-sm font-semibold">{fmtMil(planned)} 百万円</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="text-slate-500">差額（必要資金額 − 新規借入予定額）</div>
            <div className="mt-1 text-sm font-semibold">{gap === null ? '保留' : `${fmtMil(gap)} 百万円`}</div>
            <div className="mt-1 text-slate-600">自動算出した必要額を借入実行額として確定していません。</div>
          </div>
        </div>
        {form.newLoans.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
            新規借入は未入力です（入力がないため新規借入は0として計算しています）。
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1 text-left">名称</th>
                  <th className="px-2 py-1 text-left">実行年度</th>
                  <th className="px-2 py-1 text-left">実行月（空欄は1月）</th>
                  <th className="px-2 py-1 text-left">金額（百万円）</th>
                  <th className="px-2 py-1 text-left">金利（%）</th>
                  <th className="px-2 py-1 text-left">返済期間（年）</th>
                  <th className="px-2 py-1 text-left">据置（年）</th>
                  <th className="px-2 py-1 text-left">返済方式</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.newLoans.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-1"><input className={inputCls} value={r.name} onChange={(e) => updateNew(r.id, { name: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.drawYear} inputMode="numeric" onChange={(e) => updateNew(r.id, { drawYear: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.drawMonth} inputMode="numeric" onChange={(e) => updateNew(r.id, { drawMonth: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.amount} inputMode="decimal" onChange={(e) => updateNew(r.id, { amount: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.rate} inputMode="decimal" onChange={(e) => updateNew(r.id, { rate: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.term} inputMode="numeric" onChange={(e) => updateNew(r.id, { term: e.target.value })} /></td>
                    <td className="px-2 py-1"><input className={inputCls} value={r.grace} inputMode="numeric" disabled={r.method === 'BULLET'} onChange={(e) => updateNew(r.id, { grace: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      <select className={inputCls} value={r.method} onChange={(e) => updateNew(r.id, { method: e.target.value as RepaymentMethod })}>
                        <option value="EQUAL_PRINCIPAL">元金均等返済</option>
                        <option value="BULLET">期日一括返済</option>
                      </select>
                    </td>
                    <td className="px-2 py-1"><button type="button" onClick={() => removeNew(r.id)} className="text-rose-600 hover:underline">削除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-500">
              利息は年初残高×金利（実行年度は実行月から年末まで按分）、元本は年度末に返済と仮定しています。
            </p>
          </div>
        )}
      </section>

      {/* 3. 年度別返済スケジュール */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900">3. 年度別返済スケジュール（百万円）</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left">項目</th>
                {yearsOut.map((y) => (
                  <th key={y.year} className="px-2 py-1 text-right">{y.year}年</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <DebtRow label="期首借入残高" years={yearsOut} pick={(y) => y.openingBalance} />
              <DebtRow label="新規借入額" years={yearsOut} pick={(y) => y.draw} />
              <DebtRow label="元本返済額（既存＋新規）" years={yearsOut} pick={(y) => y.principal} strong />
              <DebtRow label="　うち既存借入" years={yearsOut} pick={(y) => y.existingPrincipal} />
              <DebtRow label="　うち新規借入" years={yearsOut} pick={(y) => y.newPrincipal} />
              <DebtRow label="期末借入残高" years={yearsOut} pick={(y) => y.closingBalance} strong />
              <DebtRow label="支払利息（既存＋新規）" years={yearsOut} pick={(y) => y.interest} />
              <DebtRow label="　うち既存借入" years={yearsOut} pick={(y) => y.existingInterest} />
              <DebtRow label="　うち新規借入" years={yearsOut} pick={(y) => y.newInterest} />
              <DebtRow label="年間元利返済額" years={yearsOut} pick={(y) => y.debtService} strong />
            </tbody>
          </table>
        </div>
        {yearsOut.some((y) => y.holds.length > 0) && (
          <div className="mt-2 space-y-1 text-xs text-amber-900">
            {yearsOut.filter((y) => y.holds.length > 0).map((y) => (
              <div key={y.year}><span className="font-semibold">{y.year}年：</span>{y.holds.join('、')}</div>
            ))}
          </div>
        )}
      </section>

      {/* 4. 財務CF */}
      <section>
        <h3>
          <TermLabel primary="4. 借入・返済によるお金の増減" term="財務CF" className="text-sm font-semibold text-slate-900" />
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left">項目（百万円）</th>
                {cfYears.map((y) => (
                  <th key={y.year} className="px-2 py-1 text-right">{y.year}年</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-2 py-1 text-slate-700">配当等の支出（入力）</td>
                {forecastYears.map((y) => (
                  <td key={y} className="px-2 py-1">
                    <input className={inputCls} value={form.dividends[y] ?? ''} inputMode="decimal" onChange={(e) => setDividend(y, e.target.value)} />
                  </td>
                ))}
              </tr>
              <Row label="新規借入受入額" years={cfYears} pick={(y) => y.draws} />
              <Row label="元本返済額（既存＋新規）" years={cfYears} pick={(y) => y.principal} />
              <Row label="配当等（入力）" years={cfYears} pick={(y) => y.dividends} />
              <Row label="借入・返済などによるお金の増減" term="財務CF（新規借入−元本返済−配当）" years={cfYears} pick={(y) => y.financingCf} strong />
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          配当は利用者が入力した額のみを使い、未入力の年度は保留です（0とはみなしません）。支払利息は営業CFの計算で控除済みのため、財務CFでは二重に控除していません。
        </p>
      </section>
    </div>
  );
}

function DebtRow({
  label,
  years,
  pick,
  strong,
}: {
  label: string;
  years: DebtYear[];
  pick: (y: DebtYear) => CfValue;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'bg-slate-50/70' : ''}>
      <td className={`px-2 py-1 ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{label}</td>
      {years.map((y) => {
        const cell = pick(y);
        return (
          <td key={y.year} className="px-2 py-1 text-right align-top" title={cell.note ?? ''}>
            <div className={cell.value === null ? 'text-amber-700' : 'text-slate-900'}>{fmtMil(cell.value)}</div>
            <BasisBadge basis={cell.basis} />
          </td>
        );
      })}
    </tr>
  );
}
