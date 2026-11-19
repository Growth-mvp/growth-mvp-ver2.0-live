'use client';

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ConditionalCf } from '@/utils/stage6/conditionalCf';

const CASH_COLOR = '#15803d';
const MIN_CASH_COLOR = '#94a3b8';
const MILLION = 1_000_000;

function Callout({ tone, title, body }: { tone: 'alert' | 'caution' | 'ok'; title: string; body: string }) {
  const style =
    tone === 'alert'
      ? 'bg-rose-50 text-rose-900 ring-rose-200'
      : tone === 'caution'
        ? 'bg-amber-50 text-amber-900 ring-amber-200'
        : 'bg-blue-50 text-blue-900 ring-blue-200';
  return (
    <div role={tone === 'alert' ? 'alert' : undefined} className={`rounded-xl px-4 py-3 ring-1 ${style}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-xs leading-5 opacity-90">{body}</div>
    </div>
  );
}

export function CashBalanceChart({
  cf,
  minCashYen,
  fundingLabel,
  fundingDetail,
}: {
  cf: ConditionalCf;
  minCashYen: number | null;
  fundingLabel: string;
  fundingDetail: string;
}) {
  const data = cf.years.map((y) => ({
    name: `${y.fiscalYear}年`,
    cash: y.closingCashYen === null ? null : y.closingCashYen / MILLION,
    minCash: minCashYen === null ? null : minCashYen / MILLION,
  }));
  const known = cf.years.filter((y) => y.closingCashYen !== null);
  const shortYears = known.filter((y) => minCashYen !== null && (y.closingCashYen as number) < minCashYen).map((y) => y.fiscalYear);
  const unknownYears = cf.years.filter((y) => y.closingCashYen === null).map((y) => y.fiscalYear);
  const hasData = known.length > 0;
  const fundingWarning = fundingLabel.includes('不足') || fundingLabel.includes('未確定') || fundingLabel.includes('保留');

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {shortYears.length > 0 ? (
          <Callout
            tone="alert"
            title="資金不足の年度があります"
            body={`${shortYears.map((y) => `${y}年度`).join('、')}に、最低必要現預金を下回る見込みです。`}
          />
        ) : (
          <Callout
            tone="ok"
            title={minCashYen === null ? '最低必要現預金が未入力です' : '資金不足はありません'}
            body={minCashYen === null ? '判定には最低必要現預金の入力が必要です。' : '全年度で最低必要現預金を上回っています。'}
          />
        )}
        <Callout tone={fundingWarning ? 'caution' : 'ok'} title={fundingLabel} body={fundingDetail} />
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-medium text-slate-600">年度別の現預金（期末・借入反映後）</div>
          <div className="text-[11px] text-slate-500">百万円</div>
        </div>
        {hasData ? (
          <div className="h-48" role="img" aria-label="年度別の現預金の見通しと最低必要現預金の折れ線グラフ">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={40} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                <Tooltip
                  formatter={(v) => (typeof v === 'number' ? `${v.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円` : '未算定')}
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(15,23,42,0.12)', fontSize: 12 }}
                />
                {minCashYen !== null && (
                  <Line type="linear" dataKey="minCash" name="最低必要現預金" stroke={MIN_CASH_COLOR} strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
                )}
                <Line type="linear" dataKey="cash" name="現預金" stroke={CASH_COLOR} strokeWidth={2.5} connectNulls={false} dot={{ r: 4, fill: '#fff', stroke: CASH_COLOR, strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">期末現預金は未算定です（0として表示していません）</p>
        )}
        {minCashYen !== null && hasData && (
          <div className="mt-1 text-[11px] text-slate-500">点線：最低必要現預金 {(minCashYen / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円</div>
        )}
        {unknownYears.length > 0 && (
          <p className="mt-1 text-[11px] text-slate-500">未算定：{unknownYears.map((y) => `${y}年度`).join('、')}（線を描いていません）</p>
        )}
      </div>
    </div>
  );
}
