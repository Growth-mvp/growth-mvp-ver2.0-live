'use client';

import { useState } from 'react';
import { parseFinanceActualInput, type FinanceActualItem } from '@/lib/stage5/financeActuals';

export type FinanceActualRecordArgs = { itemKey: string; ym: string; amountYen: number; note?: string };
export type FinanceActualRecordResult = { ok: true } | { ok: false; error: string };

export type FinanceActualSectionProps = {
  items: FinanceActualItem[];
  onRecord: (args: FinanceActualRecordArgs) => Promise<FinanceActualRecordResult> | FinanceActualRecordResult;
};
type Props = FinanceActualSectionProps;

type FormState = { ym: string; amount: string; note: string };
const EMPTY_FORM: FormState = { ym: '', amount: '', note: '' };

function FinanceActualCard({ item, onRecord }: { item: FinanceActualItem; onRecord: Props['onRecord'] }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    const parsed = parseFinanceActualInput(form);
    if (!parsed.ok) {
      setError(parsed.error);
      setSaved(null);
      return;
    }
    setSaving(true);
    const result = await Promise.resolve(onRecord({ itemKey: item.itemKey, ym: parsed.ym, amountYen: parsed.amountYen, note: parsed.note })).finally(() =>
      setSaving(false),
    );
    if (!result.ok) {
      setError(result.error);
      setSaved(null);
      return;
    }
    setError(null);
    setSaved(`${parsed.ym} の実績を保存しました`);
    setForm(EMPTY_FORM);
  };

  return (
    <div className="rounded-2xl bg-gray-50 p-4" data-testid="finance-actual-item">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">{item.label}</div>
        <div className="text-xs text-gray-600">計画：{item.planText}</div>
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-gray-600">
        <div>対象期間：{item.periodText}</div>
        <div>状態：{item.statusText}</div>
      </div>

      {!item.recordable ? (
        <p role="note" className="mt-2 text-xs text-amber-800">
          {item.unrecordableReason}
        </p>
      ) : (
        <>
          {item.actuals.length === 0 ? (
            <p className="mt-2 text-sm text-gray-700" data-testid="finance-actual-none">
              実績：未登録
            </p>
          ) : (
            <table className="mt-2 w-full text-xs text-gray-800" aria-label={`${item.label}の月次実績`}>
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="py-1 text-left font-semibold">対象年月</th>
                  <th className="py-1 text-right font-semibold">実績（円）</th>
                  <th className="py-1 text-left font-semibold">根拠・補足</th>
                  <th className="py-1 text-left font-semibold">登録・更新</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {item.actuals.map((a) => (
                  <tr key={a.ym} className="border-b border-gray-100">
                    <td className="py-1">{a.ym}</td>
                    <td className="py-1 text-right">{a.amountYen.toLocaleString('ja-JP')}</td>
                    <td className="py-1">{a.note ?? ''}</td>
                    <td className="py-1 text-gray-500">{new Date(a.recordedAt).toLocaleString('ja-JP')}</td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        className="rounded-lg border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-800 hover:bg-gray-100"
                        onClick={() => {
                          setForm({ ym: a.ym, amount: String(a.amountYen), note: a.note ?? '' });
                          setError(null);
                          setSaved(null);
                        }}
                      >
                        修正
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
            <label className="text-xs text-gray-700">
              対象年月
              <input
                type="month"
                aria-label={`${item.label}の対象年月`}
                value={form.ym}
                onChange={(e) => setForm({ ...form, ym: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-gray-700">
              実績金額（円）
              <input
                inputMode="numeric"
                aria-label={`${item.label}の実績金額`}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-gray-700 sm:col-span-2">
              根拠・補足
              <input
                aria-label={`${item.label}の根拠・補足`}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <div className="sm:col-span-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving}
                className="rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
              {saved && <span className="text-xs text-emerald-700">{saved}</span>}
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function FinanceActualSection({ items, onRecord }: Props) {
  return (
    <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm" aria-label="財務実績">
      <div className="mb-1 text-xs font-medium tracking-wide text-gray-500">財務実績（STAGE4の財務計画に対する月次実績）</div>
      <p className="mb-3 text-xs leading-5 text-gray-600">
        実績は計画とは別に保存します。計画額・STAGE6の確定業績は変わりません。KPI・KR達成率からは換算しません。
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">STAGE4で財務効果または追加費用（OPEX）を入力すると、ここに表示されます。</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <FinanceActualCard key={item.itemKey || item.label} item={item} onRecord={onRecord} />
          ))}
        </div>
      )}
    </section>
  );
}
