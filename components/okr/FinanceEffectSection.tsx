'use client';

import type { FinanceEffect, FinanceEffectKind, FinanceEffectMethod, SpendAmountBasis } from '@/types/strategy';
import {
  FINANCE_EFFECT_BASIS_LABEL,
  FINANCE_EFFECT_KIND_LABEL,
  FINANCE_EFFECT_METHOD_LABEL,
  computeFinanceEffect,
  financeEffectViewModel,
  guardFinanceEffectConfirmation,
  normalizeFinanceEffect,
} from '@/lib/financeEffect';
import {
  ORIGIN_LABEL,
  UNVERIFIED_ORIGIN_LABEL,
  blockingChecksDone,
  candidateChecks,
  type AssumptionOrigin,
} from '@/lib/okr/financeEffectCandidate';

const MILLION = 1_000_000;

type Props = {
  effect: FinanceEffect | undefined;
  disabled: boolean;
  overlapCandidates: string[];
  onChange: (next: FinanceEffect | undefined) => void;
  /** 算定前提の出所（AI提案・固定プリセット・利用者入力）。未記録の既存値は出所不明 */
  origin?: AssumptionOrigin;
  /** 施策に複数の効果があるときの見出し */
  label?: string;
  /** full：確認項目つきの全体表示。details：詳細設定の入力だけ（確認項目は親の画面で表示する） */
  mode?: 'full' | 'details';
};

function toMillion(v: number | undefined): string {
  return v === undefined ? '' : String(Math.round((v / MILLION) * 1000) / 1000);
}

function fromInput(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function fmtMillion(yen: number | undefined): string {
  if (yen === undefined) return '—';
  return `${(Math.round(yen / 1000) / 1000).toLocaleString('ja-JP')} 百万円`;
}

const inputClass = 'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px] disabled:opacity-50';
const sectionClass = 'space-y-2 rounded-md border border-zinc-200 bg-white p-3';

export function FinanceEffectSection({ effect, disabled, overlapCandidates, onChange, origin, label, mode = 'full' }: Props) {
  const current = normalizeFinanceEffect(effect);
  const result = computeFinanceEffect(current);
  const vm = financeEffectViewModel(current);
  const isFinancial = current !== undefined && current.kind !== 'NOT_FINANCIAL';
  const aiProposed = current?.source === 'AI_PROPOSED';
  const checksDone = current ? blockingChecksDone(current) : false;

  const update = (patch: Partial<FinanceEffect>) => {
    const base: FinanceEffect = current ?? { kind: 'REVENUE_UP', source: 'USER_INPUT', confirmed: false };
    onChange(guardFinanceEffectConfirmation(current, { ...base, ...patch }));
  };

  const setMillion = (key: 'unitPriceYen' | 'averageDealYen' | 'directAmountYen' | 'operatingIncomeEffectYen', raw: string) => {
    const v = fromInput(raw);
    update({ [key]: v === undefined ? undefined : v * MILLION } as Partial<FinanceEffect>);
  };

  const canConfirm = result.status === 'DRAFT' || result.status === 'CONFIRMED';

  const toggleConfirm = () => {
    if (!current) return;
    if (current.confirmed) {
      onChange({ ...current, confirmed: false, confirmedAt: undefined });
      return;
    }
    if (!canConfirm) return;
    // AI提案の効果は、意味と追加効果の確認を済ませないと確認できない（確認条件を緩めない）
    if (aiProposed && !checksDone) return;
    onChange({ ...current, confirmed: true, confirmedAt: new Date().toISOString() });
  };

  const toneClass = {
    muted: 'bg-zinc-100 text-zinc-600',
    warning: 'bg-amber-100 text-amber-800',
    info: 'bg-blue-100 text-blue-800',
    success: 'bg-emerald-100 text-emerald-800',
  }[vm.tone];

  const originText = origin ? ORIGIN_LABEL[origin] : aiProposed ? ORIGIN_LABEL.AI_PROPOSED : UNVERIFIED_ORIGIN_LABEL;
  const checks = current ? candidateChecks(current) : [];
  const meaningCheck = checks.find((c) => c.key === 'meaning');

  const statusNote = current?.confirmed
    ? 'この効果は確認済みで、STAGE6の財務試算に反映されています。'
    : canConfirm && (!aiProposed || checksDone)
      ? '確認すると、STAGE6の財務試算に反映されます。'
      : canConfirm
        ? 'AI提案の確認項目（下の2と3）を済ませると確認できます。'
        : '不足項目を入力すると確認できます。';

  const Wrap = mode === 'details' ? 'div' : 'details';

  return (
    <Wrap className={mode === 'details' ? '' : 'mt-4 rounded-lg border border-zinc-200 bg-white p-4'}>
      {mode === 'full' && (
        <summary className="cursor-pointer text-[13px] font-semibold text-zinc-800">
          {label ?? '財務効果の算定根拠（任意）'}
          <span className={`ml-2 rounded px-2 py-0.5 text-[11px] font-normal ${toneClass}`}>{vm.statusLabel}</span>
        </summary>
      )}

      <div className="mt-3 space-y-3 text-[12px] text-zinc-700">
        {vm.missingText && <p className="text-[11px] text-amber-800">{vm.missingText}</p>}

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold">効果の種類</span>
          <select
            className={inputClass}
            disabled={disabled}
            value={current?.kind ?? ''}
            onChange={(e) => {
              const kind = e.target.value as FinanceEffectKind;
              if (!kind) {
                onChange(undefined);
                return;
              }
              update({ kind, ...(kind === 'NOT_FINANCIAL' ? { method: undefined } : {}) });
            }}
          >
            <option value="">未設定（財務効果を登録しない）</option>
            {(Object.keys(FINANCE_EFFECT_KIND_LABEL) as FinanceEffectKind[]).map((k) => (
              <option key={k} value={k}>
                {FINANCE_EFFECT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        {mode === 'full' && (
          <>
        {/* 1. AIが提示した見込み額と計算式 */}
        {isFinancial && current && (
          <section className={sectionClass} aria-label="見込み額と計算式">
            <div className="text-[11px] font-semibold text-zinc-800">1. 見込み額と計算式</div>
            {result.formula ? (
              <div className="space-y-0.5">
                <div>計算式：{result.formula}</div>
                {result.annualRevenueYen !== undefined && <div>年額の売上増加：{fmtMillion(result.annualRevenueYen)}</div>}
                {result.annualOperatingEffectYen !== undefined && <div>年額の営業利益への効果：{fmtMillion(result.annualOperatingEffectYen)}</div>}
                {result.oneTimeOperatingEffectYen !== undefined && <div>一回限りの営業利益への効果：{fmtMillion(result.oneTimeOperatingEffectYen)}</div>}
                {result.referenceCostYen !== undefined && <div>参考原価（年額）：{fmtMillion(result.referenceCostYen)}（利益へは差し引かない）</div>}
              </div>
            ) : (
              <div>入力が揃うと計算式と金額を表示します。</div>
            )}
          </section>
        )}

        {/* 2. 前提数値の根拠・確認状況 */}
        {isFinancial && current && (
          <section className={sectionClass} aria-label="前提数値の根拠と確認状況">
            <div className="text-[11px] font-semibold text-zinc-800">2. 前提数値の根拠・確認状況</div>
            <div>出所：{originText}</div>
            <div className="whitespace-pre-line text-zinc-600">{current.sourceNote ? current.sourceNote : '根拠は未入力です。'}</div>
            {meaningCheck && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={disabled}
                  checked={meaningCheck.done}
                  onChange={(e) => update({ meetingBasisConfirmed: e.target.checked })}
                />
                <span>{meaningCheck.label}（{meaningCheck.done ? '確認済み' : '未確認'}）</span>
              </label>
            )}
          </section>
        )}

        {/* 3. 既存売上に対する追加効果か */}
        {current?.kind === 'REVENUE_UP' && (
          <section className={sectionClass} aria-label="既存売上に対する追加効果か">
            <div className="text-[11px] font-semibold text-zinc-800">3. 既存売上に対する追加効果か</div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={disabled}
                checked={current.isIncremental === true}
                onChange={(e) => update({ isIncremental: e.target.checked })}
              />
              <span>既存の売上（直近実績・既存事業の計画）に上乗せする効果である（{current.isIncremental === true ? '確認済み' : '未確認'}）</span>
            </label>
          </section>
        )}

        {/* 4. 金額の期間・開始月・必要な終了月 */}
        {isFinancial && current && (
          <section className={sectionClass} aria-label="金額の期間">
            <div className="text-[11px] font-semibold text-zinc-800">4. 金額の期間・開始月・終了月</div>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] font-semibold">金額の単位</span>
                <select
                  className={inputClass}
                  disabled={disabled}
                  value={current.amountBasis ?? ''}
                  onChange={(e) => update({ amountBasis: (e.target.value || undefined) as SpendAmountBasis | undefined })}
                >
                  <option value="">選択してください</option>
                  {(Object.keys(FINANCE_EFFECT_BASIS_LABEL) as SpendAmountBasis[]).map((b) => (
                    <option key={b} value={b}>
                      {FINANCE_EFFECT_BASIS_LABEL[b]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold">効果の開始月</span>
                <input type="month" className={inputClass} disabled={disabled} value={current.startYm ?? ''} onChange={(e) => update({ startYm: e.target.value || undefined })} />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold">終了月（空欄＝継続）</span>
                <input type="month" className={inputClass} disabled={disabled} value={current.endYm ?? ''} onChange={(e) => update({ endYm: e.target.value || undefined })} />
              </label>
            </div>
          </section>
        )}

        {/* 5. 営業利益への増分効果（利益は推定しない。未入力は未算定） */}
        {current?.kind === 'REVENUE_UP' && (
          <section className={sectionClass} aria-label="営業利益への増分効果">
            <div className="text-[11px] font-semibold text-zinc-800">5. 営業利益への増分効果</div>
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold">売上増加に伴う営業利益の増分（百万円・変動費・追加費用を含む純額）</span>
              <input
                type="number"
                step="any"
                className={inputClass}
                disabled={disabled}
                value={toMillion(current.operatingIncomeEffectYen)}
                onChange={(e) => setMillion('operatingIncomeEffectYen', e.target.value)}
              />
            </label>
            <div className="text-[11px] text-zinc-600">
              未入力の場合、営業利益は未算定になります（売上の見込みから利益を推定しません）。
            </div>
          </section>
        )}
        {current?.kind === 'COST_REDUCTION' && (
          <section className={sectionClass} aria-label="営業利益への増分効果">
            <div className="text-[11px] font-semibold text-zinc-800">5. 営業利益への増分効果</div>
            <div className="text-[11px] text-zinc-600">費用削減の金額は、そのまま営業利益の増分になります。</div>
          </section>
        )}

        {/* 6. 財務試算への反映状態 */}
        {current && (
          <section className={sectionClass} aria-label="財務試算への反映状態">
            <div className="text-[11px] font-semibold text-zinc-800">6. 財務試算への反映状態</div>
            <div>状態：{vm.statusLabel}</div>
            <div className="text-zinc-600">{statusNote}</div>
            {isFinancial && (
              <button
                type="button"
                disabled={disabled || (!current.confirmed && (!canConfirm || (aiProposed && !checksDone)))}
                onClick={toggleConfirm}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              >
                {current.confirmed ? '確認を取り消す' : '内容を確認し、確認済みにする'}
              </button>
            )}
          </section>
        )}
          </>
        )}

        {/* 詳細設定：算定方法の入力、対象範囲、重複、従来値の比較 */}
        <details className="rounded-md border border-zinc-200 bg-zinc-50 p-2" open={mode === 'details'}>
          <summary className="cursor-pointer text-[11px] font-semibold text-zinc-700">詳細設定（任意・必要なときだけ）</summary>
          <div className="mt-2 space-y-3">
            {!current && (
              <p className="text-[11px] text-zinc-600">
                財務効果は任意です。金額を算定できない施策は、未設定のままで構いません。KRの実績とチェックインは、財務効果とは別に記録できます。
              </p>
            )}

            {!current && mode === 'details' && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange({ kind: 'REVENUE_UP', source: 'USER_INPUT', confirmed: false, method: 'DIRECT_AMOUNT' })}
                className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-[12px] font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50"
              >
                金額を直接入力して登録する
              </button>
            )}

            {isFinancial && current && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold">算定方法</span>
                  <select
                    className={inputClass}
                    disabled={disabled}
                    value={current.method ?? ''}
                    onChange={(e) => update({ method: (e.target.value || undefined) as FinanceEffectMethod | undefined })}
                  >
                    <option value="">選択してください</option>
                    {(Object.keys(FINANCE_EFFECT_METHOD_LABEL) as FinanceEffectMethod[])
                      .filter((m) => m !== 'FUNNEL' || current.kind === 'REVENUE_UP')
                      .map((m) => (
                        <option key={m} value={m}>
                          {FINANCE_EFFECT_METHOD_LABEL[m]}
                        </option>
                      ))}
                  </select>
                </label>

                {current.method === 'QUANTITY_UNIT_PRICE' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold">数量</span>
                      <input type="number" className={inputClass} disabled={disabled} value={current.quantity ?? ''} onChange={(e) => update({ quantity: fromInput(e.target.value) })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold">単価（百万円）</span>
                      <input type="number" step="any" className={inputClass} disabled={disabled} value={toMillion(current.unitPriceYen)} onChange={(e) => setMillion('unitPriceYen', e.target.value)} />
                    </label>
                  </div>
                )}

                {current.method === 'FUNNEL' && (
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold">商談数</span>
                      <input type="number" className={inputClass} disabled={disabled} value={current.meetingsPerPeriod ?? ''} onChange={(e) => update({ meetingsPerPeriod: fromInput(e.target.value) })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold">受注率（%）</span>
                      <input type="number" className={inputClass} disabled={disabled} value={current.winRatePct ?? ''} onChange={(e) => update({ winRatePct: fromInput(e.target.value) })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold">平均受注額（百万円）</span>
                      <input type="number" step="any" className={inputClass} disabled={disabled} value={toMillion(current.averageDealYen)} onChange={(e) => setMillion('averageDealYen', e.target.value)} />
                    </label>
                  </div>
                )}

                {current.method === 'DIRECT_AMOUNT' && (
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold">金額（百万円）</span>
                    <input type="number" step="any" className={inputClass} disabled={disabled} value={toMillion(current.directAmountYen)} onChange={(e) => setMillion('directAmountYen', e.target.value)} />
                  </label>
                )}

                {current.kind === 'REVENUE_UP' && (
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold">原価率（%・参考。利益へは自動で差し引かない）</span>
                    <input type="number" className={inputClass} disabled={disabled} value={current.costRatePct ?? ''} onChange={(e) => update({ costRatePct: fromInput(e.target.value) })} />
                  </label>
                )}

                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold">対象範囲</span>
                  <input type="text" className={inputClass} disabled={disabled} value={current.scopeNote ?? ''} onChange={(e) => update({ scopeNote: e.target.value || undefined })} />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold">算定根拠・出所</span>
                  <textarea className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] disabled:opacity-50" rows={2} disabled={disabled} value={current.sourceNote ?? ''} onChange={(e) => update({ sourceNote: e.target.value || undefined })} />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold">この値の出所</span>
                  <select className={inputClass} disabled={disabled} value={current.source} onChange={(e) => update({ source: e.target.value as FinanceEffect['source'] })}>
                    <option value="USER_INPUT">利用者が入力した</option>
                    <option value="AI_PROPOSED">AIが提案した（未確認）</option>
                  </select>
                </label>
              </>
            )}

            {current && current.kind !== 'NOT_FINANCIAL' && (
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold">既存実績・他施策との重複について</span>
                <textarea className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] disabled:opacity-50" rows={2} disabled={disabled} value={current.overlapNote ?? ''} onChange={(e) => update({ overlapNote: e.target.value || undefined })} />
              </label>
            )}

            {overlapCandidates.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                <div className="font-semibold">重複の可能性がある施策（自動では除外しません）</div>
                <ul className="mt-1 list-disc pl-4">
                  {overlapCandidates.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            )}

            {current && (
              <button type="button" disabled={disabled} onClick={() => onChange(undefined)} className="text-[11px] font-semibold text-red-700 hover:text-red-900 disabled:opacity-50">
                財務効果の入力を削除
              </button>
            )}
          </div>
        </details>
      </div>
    </Wrap>
  );
}
