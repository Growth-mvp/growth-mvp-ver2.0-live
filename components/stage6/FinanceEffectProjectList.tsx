'use client';

import { useState } from 'react';
import type { FinanceEffectProjectRow, FinanceEffectProjectStatus, FinanceEffectTrialYear } from '@/utils/stage6/financeEffectPlan';

const INITIAL_ROWS = 5;
const MILLION = 1_000_000;

const STATUS_LABEL: Record<FinanceEffectProjectStatus, { label: string; tone: string }> = {
  REFLECTED: { label: '試算に反映（確認済み）', tone: 'bg-emerald-100 text-emerald-800' },
  DRAFT: { label: '未確認のため未反映', tone: 'bg-amber-100 text-amber-800' },
  INCOMPLETE: { label: '入力不足のため未算定', tone: 'bg-amber-100 text-amber-800' },
  NOT_FINANCIAL: { label: '財務換算しない施策', tone: 'bg-slate-100 text-slate-600' },
  NOT_SET: { label: '財務効果の登録なし', tone: 'bg-slate-100 text-slate-600' },
};

const fiscalLabel = (fy: number) => `${fy}年度`;

/** 百万円表示。0は0.0、符号つき。未算定は呼び出し側で「未算定」と書く */
export function signedMil(yen: number): string {
  const v = Math.round((yen / MILLION) * 10) / 10;
  const text = Math.abs(v).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (v === 0) return '0.0';
  return `${v > 0 ? '+' : '−'}${text}`;
}

function periodText(row: FinanceEffectProjectRow): string {
  if (row.startFiscalYear === null) return '—';
  const start = fiscalLabel(row.startFiscalYear);
  if (row.endFiscalYear === null) return `${start}〜（終了未設定）`;
  return row.startFiscalYear === row.endFiscalYear ? start : `${start}〜${fiscalLabel(row.endFiscalYear)}`;
}


function AmountCell({ years, pick }: { years: FinanceEffectProjectRow['years']; pick: 'revenue' | 'op' }) {
  const rows = years.filter((y) => {
    const value = pick === 'revenue' ? y.revenueYen : y.operatingIncomeYen;
    return value === null || value !== 0;
  });
  if (rows.length === 0) return <span className="text-xs text-slate-500">効果なし</span>;
  return (
    <ul className="space-y-0.5 text-right">
      {rows.map((y) => {
        const value = pick === 'revenue' ? y.revenueYen : y.operatingIncomeYen;
        return (
          <li key={y.fiscalYear} className="text-xs text-slate-800">
            <span className="text-slate-500">{fiscalLabel(y.fiscalYear)}</span>{' '}
            {value === null ? <span className="font-semibold text-amber-800">未算定</span> : <span className="font-semibold">{signedMil(value)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function ProjectRow({ row }: { row: FinanceEffectProjectRow }) {
  const status = STATUS_LABEL[row.status];
  return (
    <li className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-900">{row.projectTitle}</div>
        <div className="truncate text-xs text-slate-500">{row.deptName}</div>
      </div>
      <div className="text-xs text-slate-700">{row.status === 'REFLECTED' || row.startFiscalYear !== null ? periodText(row) : '—'}</div>
      <div>{row.status === 'REFLECTED' ? <AmountCell years={row.years} pick="revenue" /> : <span className="block text-right text-xs text-slate-400">—</span>}</div>
      <div>{row.status === 'REFLECTED' ? <AmountCell years={row.years} pick="op" /> : <span className="block text-right text-xs text-slate-400">—</span>}</div>
      <div className="min-w-0">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
        {row.status === 'REFLECTED' && row.operatingUnknown && (
          <div className="mt-1 text-[11px] text-amber-800">営業利益は算定できない年度を含みます（0として扱っていません）</div>
        )}
        {row.reason && <div className="mt-1 text-[11px] leading-snug text-slate-600 break-keep">{row.reason}</div>}
      </div>
    </li>
  );
}

export function FinanceEffectProjectList({ projects, years }: { projects: FinanceEffectProjectRow[]; years: FinanceEffectTrialYear[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? projects : projects.slice(0, INITIAL_ROWS);
  const reflected = projects.filter((p) => p.status === 'REFLECTED').length;

  return (
    <section aria-label="プロジェクト別の財務効果" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h4 className="text-sm font-bold text-slate-900">プロジェクト別の財務効果</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
          試算に反映されるのは、利用者が確認済みにした財務効果だけです。未確認・入力不足・算定不能の施策は0円として扱わず、理由を表示しています。
          既存事業の増減（ベースシナリオ）と施策効果は別々に表示し、下の合計はSTAGE6のグラフと同じ値です。
        </p>
      </div>

      {years.length > 0 && (
        <table className="min-w-full text-xs text-slate-800" aria-label="施策効果の年度別合計（試算に反映済み）">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className="px-2 py-1 text-left font-semibold">年度</th>
              <th className="px-2 py-1 text-right font-semibold">売上効果（百万円）</th>
              <th className="px-2 py-1 text-right font-semibold">営業利益効果（百万円）</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.fiscalYear} className="border-b border-slate-100">
                <td className="px-2 py-1">{fiscalLabel(y.fiscalYear)}</td>
                <td className="px-2 py-1 text-right">{signedMil(y.revenueYen)}</td>
                <td className="px-2 py-1 text-right">
                  {y.revenueOperatingIncomeYen === null ? '未算定' : signedMil(y.revenueOperatingIncomeYen + y.costReductionYen - y.costIncreaseYen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">表示するプロジェクトがありません。</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b border-slate-200 pb-2 text-xs font-semibold text-slate-600">
            <div>プロジェクト</div>
            <div>対象年度</div>
            <div className="text-right">売上への効果</div>
            <div className="text-right">営業利益への効果</div>
            <div>反映状態</div>
          </div>
          <p className="text-[11px] text-slate-500">反映済み {reflected}件 ／ 全{projects.length}件</p>
          <ul className="divide-y divide-slate-100">
            {visible.map((row) => (
              <ProjectRow key={`${row.deptIndex}:${row.projectIndex}:${row.effectIndex}`} row={row} />
            ))}
          </ul>
          {projects.length > INITIAL_ROWS && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {expanded ? `上位${INITIAL_ROWS}件に戻す` : `全${projects.length}件を表示`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
