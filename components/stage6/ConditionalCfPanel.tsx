import type { ConditionalCf } from '@/utils/stage6/conditionalCf';

const MILLION = 1_000_000;
const UNCALCULATED = '未算定';

function mil(v: number) {
  return (v / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function valueOrUncalculated(v: number | null) {
  return v === null ? UNCALCULATED : mil(v);
}

function taxText(rate: number | null) {
  return rate === null ? `${UNCALCULATED}（税率が未確定のため営業CFを算定しません）` : `${(rate * 100).toFixed(1)}%（既存CFと同じ税率の前提）`;
}

export function ConditionalCfPanel({ cf }: { cf: ConditionalCf }) {
  const reasons = Array.from(new Set(cf.years.flatMap((y) => y.unknownReasons)));
  const closingLabel = cf.debtEnabled ? '借入反映後' : '借入反映前（借入計画は未入力）';

  return (
    <section aria-label="条件付きCF試算" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h4 className="text-sm font-bold text-slate-900">条件付きCF試算（確認済み効果のみ）</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
          基準は直近実績の横ばいです。確認済みの施策効果のうち、統一PLの営業利益に反映できたものだけを営業CFに加えています。既存のCF表（経営目標への補間）とは別の計算で、既存の表は変更していません。
        </p>
      </div>

      <dl className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
        <div className="rounded border border-slate-200 p-2">
          <dt className="font-semibold">税率</dt>
          <dd className="mt-1">{taxText(cf.taxRate)}</dd>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <dt className="font-semibold">運転資金・減価償却・投資・借入</dt>
          <dd className="mt-1">既存の計画の値をそのまま使います（施策効果では変えません）。</dd>
        </div>
      </dl>

      <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
        <li>条件付きCF：確認済みの施策効果に基づく試算（この表）。</li>
        <li>目標補間CF：経営目標へ到達する仮想的な経路で、業績予測ではありません（上の既存のCF表）。</li>
        <li>未算定：必要な前提が不足している状態。条件付きCFが未算定でも、目標補間CFで代用しません。</li>
      </ul>

      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className="px-2 py-1 text-left font-semibold">年度</th>
              <th className="px-2 py-1 font-semibold">営業利益（統一PL）</th>
              <th className="px-2 py-1 font-semibold">営業CF（基準）</th>
              <th className="px-2 py-1 font-semibold">営業CF（条件付き）</th>
              <th className="px-2 py-1 font-semibold">投資CF</th>
              <th className="px-2 py-1 font-semibold">財務CF</th>
              <th className="px-2 py-1 font-semibold">期首現預金</th>
              <th className="px-2 py-1 font-semibold">期末現預金（{closingLabel}・条件付き）</th>
              <th className="px-2 py-1 font-semibold">期末現預金（{closingLabel}・基準）</th>
            </tr>
          </thead>
          <tbody>
            {cf.years.map((y) => (
              <tr key={y.fiscalYear} className="border-b border-slate-100 text-slate-800">
                <td className="px-2 py-1 text-left">{y.fiscalYear}年度</td>
                <td className="px-2 py-1">{valueOrUncalculated(y.operatingIncomeYen)}</td>
                <td className="px-2 py-1">{valueOrUncalculated(y.operatingCf.baselineYen)}</td>
                <td className="px-2 py-1 font-semibold">{valueOrUncalculated(y.operatingCf.conditionalYen)}</td>
                <td className="px-2 py-1">{valueOrUncalculated(y.investingCfYen)}</td>
                <td className="px-2 py-1">{cf.debtEnabled ? valueOrUncalculated(y.financingCfYen) : '未入力'}</td>
                <td className="px-2 py-1">{valueOrUncalculated(y.openingCashYen)}</td>
                <td className="px-2 py-1 font-semibold">{valueOrUncalculated(y.closingCashYen)}</td>
                <td className="px-2 py-1">{valueOrUncalculated(y.baselineClosingCashYen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-slate-500">
          単位：百万円。「未算定」は計算していない欄で、0ではありません。未算定の年度の後続年度も、期首現預金が決まらないため未算定です。
        </p>
      </div>

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

      <p className="text-[11px] text-slate-500">
        従来の北極星の金額は加算していません。回収・支払の条件（日数）は入力されていないため、運転資金は既存の残高比率をそのまま使っています。
      </p>
    </section>
  );
}
