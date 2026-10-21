'use client';

import type { CashFlowPlan } from '@/utils/stage6/cashflow';
import type { DebtSchedule } from '@/utils/stage6/debt';
import { Row, TermLabel, fmtMil } from './CashFlowSection';
import {
  moveLabelOf,
  overallVerdictOf,
  repaymentOutlook,
  verdictNarrativeOf,
  type FinanceTab,
  type UnconfirmedItem,
} from './financePlanStatus';

type Tone = 'ok' | 'warn' | 'hold' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-emerald-200 bg-emerald-50',
  warn: 'border-amber-200 bg-amber-50',
  hold: 'border-slate-200 bg-slate-50',
  neutral: 'border-slate-200 bg-white',
};

export function KpiCard({
  label,
  term,
  value,
  note,
  tone = 'neutral',
  onClick,
  actionLabel,
}: {
  label: string;
  term?: string;
  value: string;
  note?: string;
  tone?: Tone;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const body = (
    <>
      <TermLabel primary={label} term={term} className="text-sm font-semibold text-slate-700" />
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
      {note && <div className="mt-1 text-xs leading-relaxed text-slate-600">{note}</div>}
      {actionLabel && <div className="mt-2 text-xs font-semibold text-indigo-700">{actionLabel} →</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-xl border p-4 text-left hover:shadow-sm ${TONE_CLASS[tone]}`}
      >
        {body}
      </button>
    );
  }
  return <div className={`rounded-xl border p-4 ${TONE_CLASS[tone]}`}>{body}</div>;
}

function verdictClass(v: string): string {
  if (v.startsWith('資金不足')) return 'bg-rose-50 text-rose-700';
  if (v.startsWith('返済原資')) return 'bg-rose-50 text-rose-700';
  if (v.startsWith('評価保留')) return 'bg-amber-50 text-amber-800';
  return 'bg-emerald-50 text-emerald-700';
}

const VERDICT_TONE_CLASS: Record<'ok' | 'warn' | 'hold', string> = {
  ok: 'border-emerald-300 bg-emerald-50',
  warn: 'border-rose-300 bg-rose-50',
  hold: 'border-slate-300 bg-slate-50',
};

type Props = {
  plan: CashFlowPlan;
  schedule: DebtSchedule;
  debtEntered: boolean;
  fundingNeed: number | null;
  items: UnconfirmedItem[];
  reviewCandidateCount: number;
  onNavigate: (tab: FinanceTab) => void;
};

export function FinanceVerdictPanel({
  plan,
  schedule,
  debtEntered,
  fundingNeed,
  items,
  reviewCandidateCount,
  onNavigate,
}: Props) {
  const forecast = plan.years.filter((y) => y.kind === 'FORECAST');
  const outlook = repaymentOutlook({ debtEntered, years: forecast });
  const verdict = overallVerdictOf(outlook);
  const narrative = verdictNarrativeOf({ debtEntered, years: forecast });
  const dscrValues = forecast.map((y) => y.dscr.value);
  const minDscr =
    dscrValues.length > 0 && dscrValues.every((v): v is number => v !== null) ? Math.min(...dscrValues) : null;
  const minDscrYear = minDscr === null ? null : forecast.find((y) => y.dscr.value === minDscr)?.year ?? null;
  const lastYear = forecast[forecast.length - 1];
  const closingCashYen = lastYear?.closingCashAfterFinancing.value ?? null;

  const requiredItems = uniqueByLabel(items.filter((i) => i.required));
  const referenceItems = uniqueByLabel(items.filter((i) => !i.required));
  const hasActions = requiredItems.length > 0 || reviewCandidateCount > 0;

  return (
    <div className="space-y-6">
      <section className={`rounded-2xl border p-5 ${VERDICT_TONE_CLASS[verdict.tone]}`}>
        <div className="text-xs font-semibold text-slate-600">① 結論</div>
        <div className="mt-1 text-lg font-bold leading-relaxed text-slate-900 break-keep">{narrative.conclusion}</div>
        <div className="mt-2 text-xs text-slate-600">判定：{verdict.label}</div>
        {verdict.tone === 'warn' && outlook.detail && (
          <p className="mt-1 text-xs text-slate-600">該当年度：{outlook.detail}</p>
        )}
        {minDscr !== null && (
          <p className="mt-3 text-xs text-slate-500">
            参考指標：簡易DSCR {minDscr.toFixed(2)}倍（{minDscrYear}年・期間中の最小）
          </p>
        )}
      </section>

      <section>
        <h3 className="text-base font-bold text-slate-900">② 理由</h3>
        {narrative.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-800">
            {narrative.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-base font-bold text-slate-900">③ 次の行動</h3>
        {!hasActions ? (
          <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            判定を妨げる未確認事項はありません。
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {reviewCandidateCount > 0 && (
              <li className="flex flex-col gap-2 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
                <span className="text-slate-900">
                  経営目標と施策の効果を見直す（見直し候補 {reviewCandidateCount}件）
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('target')}
                  className="shrink-0 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 md:self-auto"
                >
                  {moveLabelOf('target')}
                </button>
              </li>
            )}
            {requiredItems.map((item) => (
              <li
                key={item.key}
                className="flex flex-col gap-2 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between"
              >
                <span className="text-slate-900">{item.label}</span>
                <button
                  type="button"
                  onClick={() => onNavigate(item.tab)}
                  className="shrink-0 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 md:self-auto"
                >
                  {moveLabelOf(item.tab)}
                </button>
              </li>
            ))}
          </ul>
        )}

        {referenceItems.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-slate-600">参考（判定には影響しません）</div>
            <ul className="mt-1 space-y-1 text-sm text-slate-700">
              {referenceItems.map((item) => (
                <li key={item.key} className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <span>{item.label}</span>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.tab)}
                    className="self-start text-xs font-semibold text-indigo-700 hover:underline md:self-auto"
                  >
                    {moveLabelOf(item.tab)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <h3 className="text-base font-bold text-slate-900">④ 詳細指標</h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard
            label="資金不足額"
            value={fundingNeed === null ? '未確定' : `${fmtMil(fundingNeed)} 百万円`}
            note="借入反映前の年度別不足額の最大。新規借入額は自動確定しません。"
          />
          <KpiCard
            label="事業からの返済余力"
            term="簡易DSCR・期間中の最小"
            value={minDscr === null ? '未確定' : `${minDscr.toFixed(2)} 倍`}
            note={minDscrYear === null ? '算定できる年度がありません。' : `${minDscrYear}年の値。簡易指標です。`}
          />
          <KpiCard
            label="期末現預金"
            value={closingCashYen === null ? '未確定' : `${fmtMil(closingCashYen)} 百万円`}
            note={lastYear ? `${lastYear.year}年末（借入反映後）` : '推計年度がありません。'}
          />
        </div>

        <section>
          <h3 className="text-base font-bold text-slate-900">年度別総合財務表（百万円）</h3>
          {forecast.length === 0 ? (
            <div className="mt-2 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              推計年度がありません。STAGE1の財務実績を確認してください。
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">項目</th>
                    {forecast.map((y) => (
                      <th key={y.year} className="px-2 py-2 text-right font-semibold">{y.year}年（推計）</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <Row label="売上高" years={forecast} pick={(y) => y.revenue} />
                  <Row label="営業利益" years={forecast} pick={(y) => y.operatingIncome} />
                  <Row label="事業から生まれるお金" term="営業CF" years={forecast} pick={(y) => y.operatingCf} strong />
                  <Row label="年間元利返済額" years={forecast} pick={(y) => y.debtService} />
                  <Row label="借入・返済などによるお金の増減" term="財務CF" years={forecast} pick={(y) => y.financingCf} />
                  <Row label="期末現預金（借入反映後）" years={forecast} pick={(y) => y.closingCashAfterFinancing} strong />
                  <Row label="手元に残しておきたいお金" term="最低必要現預金" years={forecast} pick={(y) => y.minCash} />
                  <Row label="不足額（借入反映後）" years={forecast} pick={(y) => y.postShortfall} strong />
                  <tr className="bg-slate-50/70">
                    <td className="px-2 py-1.5 font-semibold text-slate-900">
                      <TermLabel primary="事業からの返済余力" term="簡易DSCR（倍）" />
                    </td>
                    {forecast.map((y) => (
                      <td key={y.year} className="px-2 py-1.5 text-right font-semibold text-slate-900">
                        {y.dscr.value === null ? '未確定' : `${y.dscr.value.toFixed(2)} 倍`}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-2 py-1.5 font-semibold text-slate-900">判定</td>
                    {forecast.map((y) => (
                      <td key={y.year} className="px-2 py-1.5 text-right align-top">
                        <div className={`ml-auto inline-block max-w-[14rem] rounded px-1.5 py-0.5 text-left text-xs font-semibold ${verdictClass(y.verdict)}`}>
                          {y.verdict}
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-base font-bold text-slate-900">計算の前提と評価保留の理由</h3>
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-semibold text-slate-700">計算の前提</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
                {schedule.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-700">評価保留の理由（借入・返済）</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-amber-900">
                {schedule.globalHolds.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <TermLabel primary="事業からの返済余力の算式" term="簡易DSCR" className="font-semibold" />
            <div className="mt-1">簡易DSCR ＝（営業CF ＋ 支払利息）÷（元本返済 ＋ 支払利息）</div>
            <div className="mt-1 text-xs text-slate-500">
              営業CFは、利息を支払ったあとの事業から生まれるお金です。
            </div>
            <div className="mt-1 text-xs text-slate-500">
              簡易指標です。金融機関の融資審査で使われる指標と同一とは限りません。借入で増えた現預金は含めていません。
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            既存借入の残高は返済能力とはみなしていません。新規借入額は利用者が入力した額で、必要資金額から自動で確定していません。
          </p>
        </section>
      </section>
    </div>
  );
}

function uniqueByLabel(items: UnconfirmedItem[]): UnconfirmedItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.label)) return false;
    seen.add(i.label);
    return true;
  });
}
