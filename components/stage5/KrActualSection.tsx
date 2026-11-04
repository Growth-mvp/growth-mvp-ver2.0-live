'use client';

import { useState } from 'react';
import type { KRStructured, KrActual } from '@/types/strategy';
import { krActualView, parseKrActualInput } from '@/lib/stage5/krActual';

export type KrRecordResult = { ok: true } | { ok: false; error: string };

type Props = {
  /** undefined は、施策を特定できていない状態（KRの一覧は表示できない） */
  krs?: KRStructured[];
  onRecord: (krId: string, actual: KrActual) => KrRecordResult | Promise<KrRecordResult>;
};

type FormState = { value: string; asOf: string; note: string };

const EMPTY_FORM: FormState = { value: '', asOf: '', note: '' };

function KrActualRow({ kr, onRecord }: { kr: KRStructured; onRecord: Props['onRecord'] }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const view = krActualView(kr);
  const hasId = typeof kr.id === 'string' && kr.id.trim() !== '';

  const submit = async () => {
    if (saving) return;
    const parsed = parseKrActualInput({ value: form.value, asOf: form.asOf, note: form.note }, new Date().toISOString());
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    const result = await Promise.resolve(onRecord(kr.id, parsed.actual)).finally(() => setSaving(false));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setEditing(false);
    setForm(EMPTY_FORM);
  };

  return (
    <div className="rounded-2xl bg-gray-50 p-4" data-testid="kr-actual-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">{kr.label || '（名称未設定）'}</div>
        <div className="text-xs text-gray-600">目標：{view.targetText}</div>
      </div>

      {!hasId ? (
        <p className="mt-2 text-xs text-amber-800">
          このKRには識別子（ID）がないため、実績を記録できません。STAGE4でKRを保存し直してください。
        </p>
      ) : view.status === 'unrecorded' ? (
        <p className="mt-2 text-sm text-gray-700" data-testid="kr-actual-unrecorded">
          実績：未確認
        </p>
      ) : (
        <div className="mt-2 space-y-1 text-sm text-gray-800" data-testid="kr-actual-recorded">
          <div>実績：{view.actualText}（基準日 {view.asOf}）</div>
          <div>差：{view.diffText}</div>
          <div className="text-xs text-gray-500">
            記録日時：{view.recordedAt}
            {view.historyCount > 0 ? `（過去の実績 ${view.historyCount}件を履歴に保存）` : ''}
          </div>
          {view.note ? <div className="text-xs text-gray-600">補足：{view.note}</div> : null}
        </div>
      )}

      {hasId && !editing ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-100"
        >
          {view.status === 'recorded' ? '実績を更新' : '実績を記録'}
        </button>
      ) : null}

      {hasId && editing ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-700">
            実績値（{kr.unit}）
            <input
              inputMode="decimal"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-700">
            基準日（YYYY-MM または YYYY-MM-DD）
            <input
              value={form.asOf}
              placeholder="2026-10"
              onChange={(e) => setForm({ ...form, asOf: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-700">
            補足（任意）
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <div className="sm:col-span-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setForm(EMPTY_FORM);
              }}
              className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function KrActualSection({ krs, onRecord }: Props) {
  return (
    <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm" aria-label="KR実績">
      <div className="mb-1 text-xs font-medium tracking-wide text-gray-500">KR実績（目標指標の達成状況）</div>
      <p className="mb-3 text-xs leading-5 text-gray-600">
        作業の進み具合やチェックインとは別に、目標指標の実績を記録します。財務効果の見込みや業績の試算には使いません。
      </p>
      {krs === undefined ? (
        <p className="text-xs text-gray-500">施策を特定できないため、KRを表示できません。</p>
      ) : krs.length === 0 ? (
        <p className="text-xs text-gray-500">このプロジェクトにはKRがありません。</p>
      ) : (
        <div className="space-y-3">
          {krs.map((kr, i) => (
            <KrActualRow key={kr.id || `no-id-${i}`} kr={kr} onRecord={onRecord} />
          ))}
        </div>
      )}
    </section>
  );
}
