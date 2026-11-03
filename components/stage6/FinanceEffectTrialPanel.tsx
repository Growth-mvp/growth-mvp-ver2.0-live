import type { CfYear } from '@/utils/stage6/cashflow';
import type { FinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';

const MILLION = 1_000_000;
const UNCALCULATED = '未算定';

function mil(v: number) {
  return (v / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function signedMil(v: number) {
  return `${v > 0 ? '+' : ''}${mil(v)}`;
}

function baseMil(v: number | null) {
  return typeof v === 'number' && Number.isFinite(v) ? mil(v) : '—';
}

function withEffect(base: number | null, effect: number) {
  return typeof base === 'number' && Number.isFinite(base) ? mil(base + effect) : UNCALCULATED;
}

export function FinanceEffectTrialPanel({
  trial,
  forecastYears,
  targetEntered,
}: {
  trial: FinanceEffectTrial;
  forecastYears: CfYear[];
  targetEntered: boolean;
}) {
  const effectByYear = new Map(trial.years.map((y) => [y.fiscalYear, y]));
  const hasIncluded = trial.included.length > 0;

  return (
    <section aria-label="財務効果の条件付き試算" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h4 className="text-sm font-bold text-slate-900">確認済み仮説による条件付き試算</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
          基準は「現状延長」（基準年度の売上・営業利益を横置きした値）です。STAGE4で利用者が確認済みにした財務効果だけを重ねています。実績ではなく、既存の計画・目標は変更していません。
        </p>
        {targetEntered && (
          <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
            経営目標（目標売上・目標営業利益）は、この表の基準に含めていません。目標への補間に施策効果を重ねると二重計上になるためです。
          </p>
        )}
      </div>

      {!trial.ready && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
          決算月が未設定のため、財務効果の年度配分は行っていません。
        </p>
      )}

      {trial.ready && !hasIncluded && (
        <p className="text-xs text-slate-600">確認済みの財務効果がないため、この試算に加算する項目はありません。</p>
      )}

      {trial.ready && hasIncluded && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="px-2 py-1 text-left font-semibold">年度</th>
                <th className="px-2 py-1 font-semibold">売上（現状延長）</th>
                <th className="px-2 py-1 font-semibold">財務効果：売上</th>
                <th className="px-2 py-1 font-semibold">売上（試算）</th>
                <th className="px-2 py-1 font-semibold">営業利益（現状延長）</th>
                <th className="px-2 py-1 font-semibold">費用削減・追加費用</th>
                <th className="px-2 py-1 font-semibold">営業利益（試算）</th>
                <th className="px-2 py-1 font-semibold">現金収支</th>
              </tr>
            </thead>
            <tbody>
              {forecastYears.map((row) => {
                const effect = effectByYear.get(row.year);
                const revenueEffect = effect?.revenueYen ?? 0;
                const opEffect = effect?.operatingEffectYen ?? 0;
                return (
                  <tr key={row.year} className="border-b border-slate-100 text-slate-800">
                    <td className="px-2 py-1 text-left">{row.year}年度</td>
                    <td className="px-2 py-1">{baseMil(row.revenue.value)}</td>
                    <td className="px-2 py-1">{signedMil(revenueEffect)}</td>
                    <td className="px-2 py-1">{withEffect(row.revenue.value, revenueEffect)}</td>
                    <td className="px-2 py-1">{baseMil(row.operatingIncome.value)}</td>
                    <td className="px-2 py-1">{signedMil(opEffect)}</td>
                    <td className="px-2 py-1">{revenueEffect !== 0 ? UNCALCULATED : withEffect(row.operatingIncome.value, opEffect)}</td>
                    <td className="px-2 py-1 text-slate-500">{UNCALCULATED}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-500">
            単位：百万円。「未算定」は計算していない欄です（現状延長の値がない、または売上増加の年度の営業利益）。0とは区別してください。
          </p>
        </div>
      )}

      {trial.ready && hasIncluded && (
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
          {trial.revenueCostUnknown.length > 0 && (
            <li>
              売上増加の施策（{trial.revenueCostUnknown.map((t) => t.projectTitle).join('、')}）は、原価・変動費が未確定のため営業利益には含めていません。
            </li>
          )}
          <li>現金収支は、入出金時期・税金・運転資金の前提が財務効果に入っていないため未算定です。</li>
          {trial.legacyReferenced.length > 0 && (
            <li>
              旧来の金額（施策の影響額）は参照のみで、試算には加算していません（{trial.legacyReferenced.map((t) => t.projectTitle).join('、')}）。
            </li>
          )}
        </ul>
      )}

      {trial.excluded.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-700">試算に含めなかった財務効果</p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
            {trial.excluded.map((e, i) => (
              <li key={`${e.deptName}-${e.projectTitle}-${i}`}>
                {e.deptName} / {e.projectTitle}：{e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {trial.notSetCount > 0 && (
        <p className="text-[11px] text-slate-500">財務効果が未設定の施策：{trial.notSetCount}件</p>
      )}
    </section>
  );
}
