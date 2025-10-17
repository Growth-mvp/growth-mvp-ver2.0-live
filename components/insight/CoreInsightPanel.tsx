// /components/insight/CoreInsightPanel.tsx
'use client';

import React, { useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

type InsightResp = {
  insight: {
    headline: string;
    highlights: string[];
    risks: string[];
    levers: string[];
    metrics: Record<string, number | undefined>;
  };
};

function sumBy<T>(arr: T[], pick: (t: T)=>number){ return arr.reduce((a,b)=>a+pick(b),0); }

export default function CoreInsightPanel() {
  const s: any = useStrategyStore();
  const sim = s?.simulationResult;

  // baseline(Y0)がstore.financeSummaryの行配列から合算できると理想
  const y0 = useMemo(() => {
    const rows = Array.isArray(s?.financeSummary) ? s.financeSummary : [];
    if (!rows.length) return null;
    const latestYear = rows.reduce((m: number, r: any) => Math.max(m, Number(r?.year || 0)), 0);
    const sameYear = rows.filter((r: any) => Number(r?.year) === latestYear);
    const sales = sumBy(sameYear, (r:any)=> Number(r?.revenue||0));
    const op    = sumBy(sameYear, (r:any)=> Number(r?.operating_income||0));
    return { sales: Math.round(sales), op: Math.round(op) };
  }, [s?.financeSummary]);

  const y3 = useMemo(() => {
    const last = sim?.projection?.points?.at?.(-1);
    if (!last) return null;
    return { sales: Number(last.sales||0), op: Number(last.op||0), opMargin: Number(last.opMargin||0) };
  }, [sim]);

  const [data, setData] = useState<InsightResp['insight']|null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');

  async function run() {
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/generate-insight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseline: y0,
          y3,
          prob: typeof sim?.finalProb === 'number' ? sim.finalProb : 0,
          krs: Array.isArray(sim?.krsSnapshot) ? sim.krsSnapshot : undefined,
        }),
      });
      const json: InsightResp = await res.json();
      if (!res.ok) throw new Error((json as any)?.error || 'failed');
      setData(json.insight);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-medium">AIインサイト（試作）</h2>
        <button
          onClick={run}
          disabled={loading}
          className={[
            'text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50',
            loading ? 'opacity-60 cursor-not-allowed' : '',
          ].join(' ')}
        >
          {loading ? '生成中…' : 'インサイトを生成'}
        </button>
      </div>

      {!data && !err && (
        <p className="text-sm text-gray-500">「インサイトを生成」を押すと、Y0↔Y3の差分とKRに基づく示唆を表示します。</p>
      )}
      {err && <p className="text-sm text-rose-600">❌ {err}</p>}

      {data && (
        <div className="mt-2 space-y-4">
          <div>
            <p className="text-base font-semibold">{data.headline}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="text-sm font-medium mb-1">ハイライト</p>
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                {data.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="text-sm font-medium mb-1">リスク</p>
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                {data.risks.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="text-sm font-medium mb-1">主要レバー</p>
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                {data.levers.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-3">
            <p className="text-sm font-medium mb-1">主要指標</p>
            <div className="text-xs text-gray-600 grid grid-cols-2 md:grid-cols-4 gap-y-1">
              {Object.entries(data.metrics).map(([k,v])=>(
                <div key={k} className="flex items-center gap-2">
                  <span className="w-36 text-gray-500">{k}</span>
                  <span className="font-medium">{(v ?? '').toString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
