'use client';

import type { FinanceEffect, FinanceEffectKind, FinanceEffectMethod, SpendAmountBasis } from '@/types/strategy';
import {
  FINANCE_EFFECT_BASIS_LABEL,
  FINANCE_EFFECT_KIND_LABEL,
  FINANCE_EFFECT_METHOD_LABEL,
  compareLegacyImpact,
  computeFinanceEffect,
  financeEffectViewModel,
  guardFinanceEffectConfirmation,
  normalizeFinanceEffect,
} from '@/lib/financeEffect';

const MILLION = 1_000_000;

type Props = {
  effect: FinanceEffect | undefined;
  legacy?: { revenueMJPY?: number; opIncomeMJPY?: number };
  disabled: boolean;
  overlapCandidates: string[];
  onChange: (next: FinanceEffect | undefined) => void;
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

export function FinanceEffectSection({ effect, legacy, disabled, overlapCandidates, onChange }: Props) {
  const current = normalizeFinanceEffect(effect);
  const result = computeFinanceEffect(current);
  const vm = financeEffectViewModel(current);
  const isFinancial = current !== undefined && current.kind !== 'NOT_FINANCIAL';
  const legacyView = compareLegacyImpact(current, legacy ?? {});

  const update = (patch: Partial<FinanceEffect>) => {
    const base: FinanceEffect = current ?? { kind: 'REVENUE_UP', source: 'USER_INPUT', confirmed: false };
    onChange(guardFinanceEffectConfirmation(current, { ...base, ...patch }));
  };

  const setMillion = (key: 'unitPriceYen' | 'averageDealYen' | 'directAmountYen', raw: string) => {
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
    onChange({ ...current, confirmed: true, confirmedAt: new Date().toISOString() });
  };

  const toneClass = {
    muted: 'bg-zinc-100 text-zinc-600',
    warning: 'bg-amber-100 text-amber-800',
    info: 'bg-blue-100 text-blue-800',
    success: 'bg-emerald-100 text-emerald-800',
  }[vm.tone];

  const inputClass = 'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px] disabled:opacity-50';

  return (
    <details className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
      <summary className="cursor-pointer text-[13px] font-semibold text-zinc-800">
        財務効果の算定根拠（任意）
        <span className={`ml-2 rounded px-2 py-0.5 text-[11px] font-normal ${toneClass}`}>{vm.statusLabel}</span>
      </summary>

      <div className="mt-3 space-y-3 text-[12px] text-zinc-700">
        <p className="rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600">{vm.notice}</p>
        {vm.missingText && <p className="text-[11px] text-amber-800">{vm.missingText}</p>}

        <div className="space-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[11px] text-zinc-700">
          <div className="font-semibold">従来の成果見込みと、新しい財務効果の関係</div>
          {legacyView.rows.map((row) => (
            <div key={row.label}>
              {row.label}：{row.value}
            </div>
          ))}
          <div>財務効果の確認状態：{vm.statusLabel}</div>
          {legacyView.notes.map((note) => (
            <div key={note} className="text-amber-800">
              {note}
            </div>
          ))}
          <div>従来の売上・営業利益の見込みは、これまでどおり北極星に反映されます。確認済みの財務効果は、STAGE6の「条件付きPL試算（統一PL）」に反映されます（北極星の金額には加算しません）。</div>
        </div>

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

            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[11px] text-zinc-700">
              {result.formula ? (
                <>
                  <div>計算式：{result.formula}</div>
                  {result.annualRevenueYen !== undefined && <div>年額の売上増加：{fmtMillion(result.annualRevenueYen)}</div>}
                  {result.annualOperatingEffectYen !== undefined && <div>年額の営業利益への効果：{fmtMillion(result.annualOperatingEffectYen)}</div>}
                  {result.oneTimeOperatingEffectYen !== undefined && <div>一回限りの営業利益への効果：{fmtMillion(result.oneTimeOperatingEffectYen)}</div>}
                  {result.referenceCostYen !== undefined && <div>参考原価（年額）：{fmtMillion(result.referenceCostYen)}</div>}
                </>
              ) : (
                <div>入力が揃うと計算式と金額を表示します。</div>
              )}
            </div>

            <button
              type="button"
              disabled={disabled || (!current.confirmed && !canConfirm)}
              onClick={toggleConfirm}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              {current.confirmed ? '確認を取り消す' : '内容を確認し、確認済みにする'}
            </button>
            {!current.confirmed && !canConfirm && <p className="text-[11px] text-zinc-500">不足項目を入力すると確認できます。</p>}
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
              {overlapCandidates.map((label) => (
                <li key={label}>{label}</li>
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
  );
}
