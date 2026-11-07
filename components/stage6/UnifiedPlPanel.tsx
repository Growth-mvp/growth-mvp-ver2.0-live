import type { FinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import type { PlTarget, UnifiedPl, UnifiedPlMetricGap, UnifiedPlYear } from '@/utils/stage6/unifiedPl';

const MILLION = 1_000_000;
const UNCALCULATED = '未算定';

type Target = PlTarget;

function mil(v: number) {
  const text = (v / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

function valueOrUncalculated(v: number | null) {
  return v === null ? UNCALCULATED : mil(v);
}

/** 売上増加は「+」、費用削減は営業費用の減少で「−」、追加費用は営業費用の増加で「+」として表す */
function revenueEffectText(v: number) {
  return v > 0 ? `+${mil(v)}` : '0.0';
}

function costReductionText(v: number) {
  return v > 0 ? `−${mil(v)}` : '0.0';
}

function costIncreaseText(v: number) {
  return v > 0 ? `+${mil(v)}` : '0.0';
}

function targetText(v: number | null) {
  return v === null ? '未設定' : `${mil(v)} 百万円`;
}

function gapText(v: number | null) {
  if (v === null) return UNCALCULATED;
  if (v > 0) return `不足 ${mil(v)} 百万円`;
  return `目標を達成（${mil(-v)} 百万円超過）`;
}

function yearLabel(year: number | null | undefined) {
  return year === null || year === undefined ? '年度未設定' : `${year}年度`;
}

function metricGapText(gap: UnifiedPlMetricGap | undefined) {
  return gap && gap.valueYen !== null ? gapText(gap.valueYen) : UNCALCULATED;
}

function uniqueReasons(years: UnifiedPlYear[], gapReasons: string[]) {
  return Array.from(new Set([...years.flatMap((y) => y.unknownReasons), ...gapReasons]));
}

export function UnifiedPlPanel({
  plan,
  trial,
  target,
}: {
  plan: UnifiedPl;
  trial: FinanceEffectTrial;
  target: Target;
}) {
  const included = trial.included.length;
  const excluded = trial.excluded.length;
  const reasons = uniqueReasons(
    plan.years,
    [plan.gap?.revenue.reason, plan.gap?.operatingIncome.reason].filter((r): r is string => r !== null && r !== undefined),
  );
  const firstBaseline = plan.years.find((y) => y.baseline.revenueYen !== null) ?? plan.years[0];

  return (
    <section aria-label="条件付きPL試算（統一PL）" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h4 className="text-sm font-bold text-slate-900">条件付きPL試算（統一PL）</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
          ベースラインに、STAGE4で利用者が確認済みにした施策効果だけを年度ごとに反映したPLです。施策効果は実績ではなく、利用者が確認済みにした仮説です。経営目標・北極星の参考計算とは別の値で、キャッシュフローは含みません。
        </p>
      </div>

      <dl className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
        <div className="rounded border border-slate-200 p-2">
          <dt className="font-semibold">経営目標（STAGE2・予測に加算しない）</dt>
          <dd className="mt-1">
            売上 {targetText(target.revenueYen)}（目標年度 {yearLabel(target.revenueDueYear)}）
            ／ 営業利益 {targetText(target.operatingIncomeYen)}（目標年度 {yearLabel(target.operatingIncomeDueYear)}）
          </dd>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <dt className="font-semibold">ベースライン（直近実績を横ばいに置いた暫定仮定）</dt>
          <dd className="mt-1">
            売上 {valueOrUncalculated(firstBaseline?.baseline.revenueYen ?? null)} 百万円 ／ 営業利益{' '}
            {valueOrUncalculated(firstBaseline?.baseline.operatingIncomeYen ?? null)} 百万円（成長予測ではありません）
          </dd>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <dt className="font-semibold">確認済み施策効果</dt>
          <dd className="mt-1">
            {included > 0 ? `${included}件を反映` : '反映する効果はありません'}
            {excluded > 0 ? `（${excluded}件は試算に含めていません）` : ''}
          </dd>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <dt className="font-semibold">目標との差額（経営目標 − 条件付きPL試算）</dt>
          <dd className="mt-1">
            <div>売上（{yearLabel(plan.gap?.revenue.fiscalYear)}）：{metricGapText(plan.gap?.revenue)}</div>
            <div>営業利益（{yearLabel(plan.gap?.operatingIncome.fiscalYear)}）：{metricGapText(plan.gap?.operatingIncome)}</div>
          </dd>
        </div>
      </dl>

      {!trial.ready && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">決算月が未設定のため、施策効果の年度配分は行っていません。</p>
      )}

      {trial.ready && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="px-2 py-1 text-left font-semibold">年度</th>
                <th className="px-2 py-1 font-semibold">売上（ベースライン）</th>
                <th className="px-2 py-1 font-semibold">売上増加（確認済み効果）</th>
                <th className="px-2 py-1 font-semibold">売上（条件付きPL）</th>
                <th className="px-2 py-1 font-semibold">営業費用（ベースライン）</th>
                <th className="px-2 py-1 font-semibold">費用削減（確認済み効果）</th>
                <th className="px-2 py-1 font-semibold">追加費用（確認済み効果）</th>
                <th className="px-2 py-1 font-semibold">営業費用（条件付きPL）</th>
                <th className="px-2 py-1 font-semibold">営業利益（ベースライン）</th>
                <th className="px-2 py-1 font-semibold">営業利益（条件付きPL）</th>
              </tr>
            </thead>
            <tbody>
              {plan.years.map((y) => (
                <tr key={y.fiscalYear} className="border-b border-slate-100 text-slate-800">
                  <td className="px-2 py-1 text-left">{y.fiscalYear}年度</td>
                  <td className="px-2 py-1">{valueOrUncalculated(y.baseline.revenueYen)}</td>
                  <td className="px-2 py-1">{revenueEffectText(y.effect.revenueUpYen)}</td>
                  <td className="px-2 py-1">{valueOrUncalculated(y.plan.revenueYen)}</td>
                  <td className="px-2 py-1">{valueOrUncalculated(y.baseline.operatingExpenseYen)}</td>
                  <td className="px-2 py-1">{costReductionText(y.effect.costReductionYen)}</td>
                  <td className="px-2 py-1">{costIncreaseText(y.effect.costIncreaseYen)}</td>
                  <td className="px-2 py-1">{valueOrUncalculated(y.plan.operatingExpenseYen)}</td>
                  <td className="px-2 py-1">{valueOrUncalculated(y.baseline.operatingIncomeYen)}</td>
                  <td className="px-2 py-1 font-semibold">{valueOrUncalculated(y.plan.operatingIncomeYen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-500">
            単位：百万円。費用の欄は営業費用への増減（費用削減は減少、追加費用は増加）。「未算定」は計算していない欄で、0ではありません。
          </p>
        </div>
      )}

      {reasons.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-700">未算定の項目と理由</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
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

      {trial.legacyReferenced.length > 0 && (
        <p className="text-xs text-slate-500">
          従来の北極星の金額（施策の影響額）は削除せず参考情報として保持しており、この統一PLには加算していません（{trial.legacyReferenced.map((t) => t.projectTitle).join('、')}）。
        </p>
      )}

      {trial.notSetCount > 0 && <p className="text-xs text-slate-500">財務効果が未設定の施策：{trial.notSetCount}件</p>}
    </section>
  );
}
