'use client';

/* STAGE5：実績の登録。対象年月を1つ選び、財務実績とKR実績を並べて入力し、保存は1回にまとめる。
 * 空欄の項目は保存しない（0円・0％とは区別する）。財務実績・KR実績は、既存の記録（lib/stage5）をそのまま書く。
 * KPI・KR実績から財務実績への換算は行わない。 */
import { useEffect, useRef, useState } from 'react';
import type { KRStructured, KrActual } from '@/types/strategy';
import { FINANCE_ACTUAL_NOTE_MAX, parseFinanceActualInput, type FinanceActualItem } from '@/lib/stage5/financeActuals';
import { krActualView, parseKrActualInput } from '@/lib/stage5/krActual';
import { monthAfterLimit } from '@/lib/stage5/stoppedActuals';

export type FinanceActualRecordArgs = { itemKey: string; ym: string; amountYen: number; note?: string };
export type FinanceActualRecordResult = { ok: true } | { ok: false; error: string };
export type KrRecordResult = { ok: true } | { ok: false; error: string };

/* 相談の文脈へ渡す、登録フォームの表示中の入力状態（保存はしない。画面の値をそのまま写す） */
export type RegistrationConsultView = {
  ym: string;
  finance: Record<string, string>;
  kr: Record<string, { value: string; asOf: string }>;
  busy: boolean;
};

const YM_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type RegistrationDraft = {
  ym: string;
  finance: Record<string, string>;
  kr: Record<string, { value: string; asOf: string }>;
  note: string;
};

/* 対象年月を選んだときの入力欄：その年月に登録済みの実績があれば、その値（KRは基準日も保つ）を入れる */
export function prefillFor(ym: string, items: readonly FinanceActualItem[], krs: readonly KRStructured[]): Pick<RegistrationDraft, 'finance' | 'kr'> {
  const finance: Record<string, string> = {};
  for (const item of items) {
    const hit = item.actuals.find((a) => a.ym === ym);
    finance[item.itemKey] = hit ? String(hit.amountYen) : '';
  }
  const kr: Record<string, { value: string; asOf: string }> = {};
  for (const k of krs) {
    if (typeof k.id !== 'string' || k.id === '') continue;
    const actual = k.actual;
    if (actual && actual.asOf.startsWith(ym)) kr[k.id] = { value: String(actual.value), asOf: actual.asOf };
    else kr[k.id] = { value: '', asOf: ym };
  }
  return { finance, kr };
}

export type RegistrationStep =
  | { kind: 'FINANCE'; key: string; label: string; args: FinanceActualRecordArgs }
  | { kind: 'KR'; key: string; label: string; krId: string; actual: KrActual };

/* 入力を検証し、保存する項目だけを順に並べる。空欄は含めない。どれか1つでも不正なら、何も保存しない。
 * maxYm は中止した施策の上限（YYYY-MM）。上限より後の年月（KRの基準日を含む）は保存しない。 */
export function planRegistration(
  draft: RegistrationDraft,
  items: readonly FinanceActualItem[],
  krs: readonly KRStructured[],
  nowIso: string,
  maxYm?: string | null,
): { ok: true; steps: RegistrationStep[] } | { ok: false; error: string } {
  if (!YM_PATTERN.test(draft.ym)) return { ok: false, error: '対象年月を選んでください。' };
  const afterLimit = monthAfterLimit(draft.ym, maxYm);
  if (afterLimit) return { ok: false, error: afterLimit };
  const steps: RegistrationStep[] = [];
  let filled = 0;

  for (const item of items) {
    if (!item.recordable) continue;
    const amount = draft.finance[item.itemKey] ?? '';
    if (amount.trim() === '') continue;
    filled += 1;
    const parsed = parseFinanceActualInput({ ym: draft.ym, amount, note: draft.note });
    if (!parsed.ok) return { ok: false, error: `${item.label}：${parsed.error}` };
    const existing = item.actuals.find((a) => a.ym === draft.ym);
    if (existing && existing.amountYen === parsed.amountYen) continue;
    const note = parsed.note ?? existing?.note;
    steps.push({
      kind: 'FINANCE',
      key: item.itemKey,
      label: item.label,
      args: { itemKey: item.itemKey, ym: parsed.ym, amountYen: parsed.amountYen, ...(note ? { note } : {}) },
    });
  }

  for (const k of krs) {
    if (typeof k.id !== 'string' || k.id === '') continue;
    const input = draft.kr[k.id];
    if (!input || input.value.trim() === '') continue;
    filled += 1;
    const parsed = parseKrActualInput({ value: input.value, asOf: input.asOf, note: draft.note }, nowIso);
    if (!parsed.ok) return { ok: false, error: `${k.label}：${parsed.error}` };
    const krAfterLimit = monthAfterLimit(parsed.actual.asOf.slice(0, 7), maxYm);
    if (krAfterLimit) return { ok: false, error: `${k.label}：${krAfterLimit}` };
    const current = k.actual;
    const sameMonth = !!current && current.asOf.startsWith(draft.ym);
    if (sameMonth && current && current.value === parsed.actual.value && current.asOf === parsed.actual.asOf) continue;
    const note = parsed.actual.note ?? (sameMonth ? current?.note : undefined);
    steps.push({
      kind: 'KR',
      key: k.id,
      label: k.label || '（名称未設定）',
      krId: k.id,
      actual: { ...parsed.actual, ...(note ? { note } : {}) },
    });
  }

  if (filled === 0) return { ok: false, error: '保存する実績を入力してください。空欄の項目は保存されません。' };
  if (steps.length === 0) return { ok: false, error: '変更された実績がありません。新しい値を入力してください。' };
  return { ok: true, steps };
}

export function ActualRegistrationSection({
  items,
  krs,
  maxYm,
  onRecordFinance,
  onRecordKr,
  onDraftChange,
}: {
  items: FinanceActualItem[];
  krs?: KRStructured[];
  /** 中止した施策の、登録できる最後の年月（YYYY-MM）。中止していなければ未指定 */
  maxYm?: string | null;
  onRecordFinance: (args: FinanceActualRecordArgs) => Promise<FinanceActualRecordResult> | FinanceActualRecordResult;
  onRecordKr: (krId: string, actual: KrActual) => Promise<KrRecordResult> | KrRecordResult;
  /** 表示中の入力状態を、親に知らせる（相談の文脈用。画面の動きは変えない） */
  onDraftChange?: (view: RegistrationConsultView | null) => void;
}) {
  const krList = krs ?? [];
  const [ym, setYm] = useState('');
  const [finance, setFinance] = useState<Record<string, string>>({});
  const [kr, setKr] = useState<Record<string, { value: string; asOf: string }>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => {
    onDraftChangeRef.current?.({ ym, finance, kr, busy });
  }, [ym, finance, kr, busy]);
  useEffect(() => {
    const latest = onDraftChangeRef;
    return () => latest.current?.(null);
  }, []);

  const chooseYm = (next: string) => {
    const afterLimit = monthAfterLimit(next, maxYm);
    if (afterLimit) {
      setResult({ tone: 'error', text: afterLimit });
      return;
    }
    setYm(next);
    const p = next && YM_PATTERN.test(next) ? prefillFor(next, items, krList) : { finance: {}, kr: {} };
    setFinance(p.finance);
    setKr(p.kr);
    setResult(null);
  };

  const save = async () => {
    if (busy) return;
    const plan = planRegistration({ ym, finance, kr, note }, items, krList, new Date().toISOString(), maxYm);
    if (!plan.ok) {
      setResult({ tone: 'error', text: plan.error });
      return;
    }
    setBusy(true);
    setResult(null);
    const saved: string[] = [];
    const savedKeys: Array<{ kind: 'FINANCE' | 'KR'; key: string }> = [];
    const failed: Array<{ label: string; error: string }> = [];
    for (const step of plan.steps) {
      const r =
        step.kind === 'FINANCE' ? await onRecordFinance(step.args) : await onRecordKr(step.krId, step.actual);
      if (r.ok) {
        saved.push(step.label);
        savedKeys.push({ kind: step.kind, key: step.key });
      } else {
        failed.push({ label: step.label, error: r.error });
      }
    }
    setFinance((prev) => {
      const next = { ...prev };
      for (const s of savedKeys) if (s.kind === 'FINANCE') next[s.key] = '';
      return next;
    });
    setKr((prev) => {
      const next = { ...prev };
      for (const s of savedKeys) if (s.kind === 'KR' && next[s.key]) next[s.key] = { ...next[s.key], value: '' };
      return next;
    });
    if (failed.length === 0) setNote('');
    setBusy(false);
    if (failed.length === 0) {
      setResult({ tone: 'ok', text: `${ym} の実績を${saved.length}件保存しました（${saved.join('、')}）。` });
    } else if (saved.length > 0) {
      setResult({
        tone: 'error',
        text: `一部だけ保存されました。保存済み：${saved.join('、')}／保存できませんでした：${failed.map((f) => f.label).join('、')}。保存できなかった項目は入力を残しています。${failed[0].error}`,
      });
    } else {
      setResult({ tone: 'error', text: `保存できませんでした。${failed[0].error}` });
    }
  };

  const hasAnything = items.length > 0 || krList.some((k) => typeof k.id === 'string' && k.id !== '');

  return (
    <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm" aria-label="実績の登録">
      <div className="mb-1 text-xs font-medium tracking-wide text-gray-500">実績の登録</div>
      <p className="mb-3 text-xs leading-5 text-gray-600">
        実績は計画とは別に保存します。計画額・STAGE6の確定業績は変わりません。KPI・KR達成率から財務実績への換算はしません。
      </p>
      {krs === undefined && items.length === 0 ? (
        <p className="text-xs text-gray-500">施策を特定できないため、実績を登録できません。</p>
      ) : !hasAnything ? (
        <p className="text-xs text-gray-500">登録できる財務項目・KRはありません。</p>
      ) : (
        <div className="space-y-4">
          <label className="block max-w-xs text-xs text-gray-700">
            対象年月（共通）
            <input
              type="month"
              aria-label="対象年月"
              max={maxYm ?? undefined}
              value={ym}
              onChange={(e) => chooseYm(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>

          {ym === '' && <p className="text-xs text-gray-500">対象年月を選ぶと、登録済みの実績を確認・修正できます。</p>}

          {items.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-700">財務実績（STAGE6連動）</div>
              {items.map((item) => {
                const registered = ym ? item.actuals.find((a) => a.ym === ym) : undefined;
                return (
                  <div key={item.itemKey || item.label} className="rounded-2xl bg-gray-50 p-3 text-xs text-gray-700" data-testid="finance-actual-item">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900">{item.label}</div>
                      <div>計画：{item.planText}</div>
                    </div>
                    <div className="mt-0.5 text-gray-500">
                      対象期間：{item.periodText}　状態：{item.statusText}
                    </div>
                    {!item.recordable ? (
                      <p role="note" className="mt-2 text-amber-800">
                        {item.unrecordableReason}
                      </p>
                    ) : (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <label className="block">
                          実績金額（円）
                          <input
                            inputMode="numeric"
                            aria-label={`${item.label}の実績金額`}
                            value={finance[item.itemKey] ?? ''}
                            disabled={busy || ym === ''}
                            onChange={(e) => setFinance((prev) => ({ ...prev, [item.itemKey]: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                          />
                        </label>
                        <span className="pb-1.5 text-gray-600">
                          {ym === '' ? '' : registered ? `登録済み：${registered.amountYen.toLocaleString('ja-JP')}円` : '未登録'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {krList.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-700">KPI・KR実績（任意）</div>
              {krList.map((k, i) => {
                const hasId = typeof k.id === 'string' && k.id !== '';
                const view = krActualView(k);
                const actual = k.actual;
                const sameMonth = !!actual && !!ym && actual.asOf.startsWith(ym);
                const otherMonth = !!actual && !sameMonth;
                return (
                  <div key={k.id || `no-id-${i}`} className="rounded-2xl bg-gray-50 p-3 text-xs text-gray-700" data-testid="kr-actual-row">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900">{k.label || '（名称未設定）'}</div>
                      <div>目標：{view.targetText}</div>
                    </div>
                    {!hasId ? (
                      <p className="mt-2 text-amber-800">このKRには識別子（ID）がないため、実績を記録できません。STAGE4でKRを保存し直してください。</p>
                    ) : (
                      <>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr] sm:items-end">
                          <label className="block">
                            実績値（{k.unit}）
                            <input
                              inputMode="decimal"
                              aria-label={`${k.label}の実績値（${k.unit}）`}
                              value={kr[k.id]?.value ?? ''}
                              disabled={busy || ym === ''}
                              onChange={(e) => setKr((prev) => ({ ...prev, [k.id]: { asOf: prev[k.id]?.asOf ?? ym, value: e.target.value } }))}
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                            />
                          </label>
                          <label className="block">
                            基準日（YYYY-MM または YYYY-MM-DD）
                            <input
                              aria-label={`${k.label}の基準日`}
                              value={kr[k.id]?.asOf ?? ''}
                              disabled={busy || ym === ''}
                              onChange={(e) => setKr((prev) => ({ ...prev, [k.id]: { value: prev[k.id]?.value ?? '', asOf: e.target.value } }))}
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                            />
                          </label>
                        </div>
                        <div className="mt-1 text-gray-500">
                          {ym === ''
                            ? ''
                            : sameMonth
                              ? `登録済み：${actual!.value}${k.unit}（基準日 ${actual!.asOf}）`
                              : otherMonth
                                ? `別の基準日の実績：${actual!.value}${k.unit}（基準日 ${actual!.asOf}）。対象年月と異なるため入力欄は空です`
                                : '未登録'}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <label className="block text-xs text-gray-700">
            根拠・補足（任意・すべての実績に共通）
            <input
              aria-label="根拠・補足"
              value={note}
              disabled={busy || ym === ''}
              maxLength={FINANCE_ACTUAL_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || ym === ''}
              className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? '保存中…' : '実績を保存'}
            </button>
            {result && (
              <span role={result.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${result.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
                {result.text}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
