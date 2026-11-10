'use client';

/* STAGE6：STAGE5に登録されたKRの実績を、同じKRの計画（目標）と並べて表示する。
 * KRの実績は財務の金額に換算しない。財務の実績は登録が無いため、「実績未登録」と表示する。 */
import { buildKrPlanActualRows, FINANCIAL_ACTUAL_NOTE, type KrPlanActualRow } from '@/lib/stage5/krPlanActual';

const fmt = (v: number | null) => (v === null ? '—' : String(v));
const signed = (v: number | null) => (v === null ? '—' : v > 0 ? `+${v}` : String(v));

const STATUS_TEXT: Record<KrPlanActualRow['status'], string> = {
  COMPARABLE: '比較できます',
  NO_ACTUAL: '実績未登録',
  NO_PLAN: '計画（目標）が未設定',
  NO_ID: 'KRのIDがないため比べられません（STAGE5で保存し直してください）',
};

export function KrPlanActualPanel({ departments }: { departments: unknown }) {
  const projects = buildKrPlanActualRows(departments).filter((p) => p.rows.length > 0);
  return (
    <section aria-label="KRの計画と実績" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">KRの計画と実績（STAGE5の登録）</h3>
      <p className="mt-1 text-xs text-slate-500">
        KRの目標と実績を、同じ単位で比べます。計画・財務効果の金額は変えません。
      </p>
      <p className="mt-2 text-xs text-slate-600">{FINANCIAL_ACTUAL_NOTE}</p>
      {projects.length === 0 && <p className="mt-3 text-sm text-slate-500">KRがまだありません。</p>}
      {projects.map((p) => (
        <div key={p.projectId} className="mt-4">
          <p className="text-xs text-slate-500">
            {p.departmentName}
          </p>
          <h4 className="text-sm font-semibold text-slate-700">{p.projectTitle}</h4>
          <div className="mt-1 overflow-x-auto">
            <table className="min-w-full text-left text-xs text-slate-700">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2">KR</th>
                  <th className="py-1 pr-2">計画（目標）</th>
                  <th className="py-1 pr-2">期限</th>
                  <th className="py-1 pr-2">実績</th>
                  <th className="py-1 pr-2">基準日</th>
                  <th className="py-1 pr-2">達成率</th>
                  <th className="py-1 pr-2">差異</th>
                  <th className="py-1 pr-2">実施事項（完了／紐づけ）</th>
                  <th className="py-1">状態</th>
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.krId || r.label} className="border-t border-slate-100">
                    <td className="py-1 pr-2">{r.label}</td>
                    <td className="py-1 pr-2">
                      {fmt(r.plan)}
                      {r.plan !== null ? r.unit : ''}
                    </td>
                    <td className="py-1 pr-2">{r.due ?? '—'}</td>
                    <td className="py-1 pr-2">
                      {r.actual === null ? '未登録' : `${r.actual}${r.unit}`}
                    </td>
                    <td className="py-1 pr-2">{r.asOf ?? '—'}</td>
                    <td className="py-1 pr-2">{r.achievementPct === null ? '—' : `${r.achievementPct}%`}</td>
                    <td className="py-1 pr-2">
                      {r.difference === null ? '—' : `${signed(r.difference)}${r.unit}`}
                    </td>
                    <td className="py-1 pr-2">
                      {r.linkedTotal === 0 ? '—' : `${r.linkedDone}／${r.linkedTotal}`}
                    </td>
                    <td className="py-1">{STATUS_TEXT[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

export default KrPlanActualPanel;
