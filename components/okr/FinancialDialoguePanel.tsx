'use client';

import { useState, type ReactNode } from 'react';
import type { FinanceEffect, FinanceEffectQuestionAnswers, SpendAmountBasis, Ym } from '@/types/strategy';
import { computeFinanceEffect, financeEffectViewModel, guardFinanceEffectConfirmation, normalizeFinanceEffect } from '@/lib/financeEffect';
import { ORIGIN_LABEL, UNVERIFIED_ORIGIN_LABEL, type AssumptionOrigin } from '@/lib/okr/financeEffectCandidate';
import {
  answerMeaning,
  answerOperatingIncome,
  answerTiming,
  answerValidity,
  effectiveAnswers,
  nextFinanceQuestion,
  questionPlan,
  readyToConfirm,
  resetAnswer,
  type FinanceQuestionId,
} from '@/lib/okr/financeQuestions';
import type { ImpactAssumptions, ImpactRoleKey } from '@/lib/okr/impactAssumptions';

type Calc = { resultLabel: string; resultValue: number; formula: string };

type Props = {
  role: ImpactRoleKey | undefined;
  assumptions: ImpactAssumptions;
  calc: Calc | null;
  effect: FinanceEffect | undefined;
  origin: AssumptionOrigin | undefined;
  disabled: boolean;
  notice: string | null;
  onEffectChange: (next: FinanceEffect | undefined) => void;
  onCreateCandidate: () => void;
  assumptionEditor: ReactNode;
  detailsSlot: ReactNode;
  /** AIの確認事項が残っている間は、財務の質問を出さず、一問ずつの流れを保つ */
  deferQuestions?: boolean;
};

const BASIS_OPTIONS: { value: SpendAmountBasis; label: string }[] = [
  { value: 'ANNUAL', label: '年額（毎年続く）' },
  { value: 'MONTHLY', label: '月額（毎月続く）' },
  { value: 'TOTAL', label: '一度限り（合計額）' },
];

const RESEARCH_HINT: Record<FinanceQuestionId, string> = {
  validity: '根拠になる過去12か月の商談数・受注率、または市場データを確認してください。',
  meaning: '同じ取引が既存の売上実績に含まれていないか、売上台帳で確認してください。確認するまで財務試算には入りません。',
  timing: '契約・受注の開始予定月と、毎年続く取引か一度限りかを確認してください。',
  operatingIncome: '変動費や追加の人件費を差し引いた額が必要です。分からなければ未算定のまま保存できます。',
};

const QUESTION_TITLE: Record<FinanceQuestionId, string> = {
  validity: '数字の妥当性',
  meaning: '売上の意味',
  timing: '発生時期',
  operatingIncome: '営業利益への増分',
};

const btn = 'rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-blue-900 hover:bg-blue-50 disabled:opacity-50';
const primaryBtn = 'rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';

export function FinancialDialoguePanel(props: Props) {
  const { role, assumptions, calc, effect, origin, disabled, notice, onEffectChange, onCreateCandidate, assumptionEditor, detailsSlot, deferQuestions } = props;
  const [editOpen, setEditOpen] = useState(false);
  const [timingDraft, setTimingDraft] = useState<{ startYm: string; basis: '' | SpendAmountBasis }>({
    startYm: effect?.startYm ?? '',
    basis: effect?.amountBasis ?? '',
  });
  const [oiDraft, setOiDraft] = useState('');

  if (role === 'FUTURE') {
    return (
      <section aria-label="売上・利益への効果" className="mt-4 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-[12px] text-zinc-700">
        <p>将来投資の金額は、下の「投資（金額 or 人数）」で登録します。財務効果の質問は売上・費用の施策で行います。</p>
      </section>
    );
  }
  if (!role) {
    return (
      <section aria-label="売上・利益への効果" className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-[12px] text-zinc-700">
        「売上を伸ばす」か「ムダを減らす」を選ぶと、AIが金額の見込みと計算式を示します。
      </section>
    );
  }

  const current = normalizeFinanceEffect(effect);
  const question = nextFinanceQuestion(role, current);
  const answers: FinanceEffectQuestionAnswers = current ? effectiveAnswers(current) : {};
  const plan = questionPlan(role);
  const vm = financeEffectViewModel(current);
  const result = computeFinanceEffect(current);
  const originText = origin ? ORIGIN_LABEL[origin] : current?.source === 'AI_PROPOSED' ? ORIGIN_LABEL.AI_PROPOSED : UNVERIFIED_ORIGIN_LABEL;
  const effectMillion = (yen: number | undefined) => (yen === undefined ? undefined : Math.round(yen / 100_000) / 10);
  const amountMil = calc?.resultValue ?? effectMillion(result.annualRevenueYen ?? result.totalYen ?? result.amountYen ?? current?.directAmountYen);
  const update = (next: FinanceEffect) => onEffectChange(guardFinanceEffectConfirmation(current, next));

  const stage6Note = (() => {
    if (!current) return '';
    if (answers.meaning === 'NO') return '既存の売上に含まれるため、財務試算には加算しません。';
    if (current.confirmed && result.status === 'CONFIRMED') return '確認済みのため、STAGE6の財務試算に反映されます。';
    if (result.status === 'DRAFT') return '未確認のため、財務試算にはまだ入りません。';
    if (result.status === 'INCOMPLETE') return `未入力：${result.missing.join('、')}`;
    if (result.status === 'NOT_FINANCIAL') return '非財務の効果のため、財務試算には含めません。';
    return '';
  })();

  const questionNumber = question ? plan.indexOf(question) + 1 : 0;
  const isRevenue = role === 'REVENUE';
  const a = assumptions;

  const questionText = (id: FinanceQuestionId): string => {
    if (id === 'validity') {
      const hasFormulaInputs = isRevenue ? a.targetCustomers !== undefined : a.currentCostMJPY !== undefined;
      if (!hasFormulaInputs) return `この見込み金額（${amountMil ?? '—'}百万円）の根拠は、会社の実績や確認できる数字で説明できますか？`;
      return isRevenue
        ? `対象顧客${a.targetCustomers ?? '—'}社という数字は、実際の営業先や市場の見込みから考えて妥当ですか？`
        : `現在コスト${a.currentCostMJPY ?? '—'}百万円のうち${a.reductionRatePct ?? '—'}%を減らせる、という数字は妥当ですか？`;
    }
    if (id === 'meaning') return `この${amountMil ?? '—'}百万円は、現在の売上に新しく追加される売上ですか？`;
    if (id === 'timing') {
      return isRevenue
        ? 'いつ頃から売上が発生し、年間の金額ですか、それとも一度限りの金額ですか？'
        : 'いつ頃から効果が出て、年間の削減額ですか、それとも一度限りですか？';
    }
    return `売上が${amountMil ?? '—'}百万円増えた場合、追加費用を差し引いて営業利益はいくら増える見込みですか？`;
  };

  const renderQuestion = (id: FinanceQuestionId) => {
    if (!current) return null;
    if (id === 'validity') {
      return (
        <div className="space-y-2">
          {editOpen ? (
            <>
              <p className="text-[11px] text-blue-900">下の「前提の数値を修正する」で数字を直してください。修正すると、見込みは自動で更新されます。</p>
              <button type="button" disabled={disabled} className={primaryBtn} onClick={() => update(answerValidity(current, 'EDITED'))}>
                修正した数字で確認して次へ
              </button>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={disabled} className={btn} onClick={() => update(answerValidity(current, 'OK'))}>
                妥当
              </button>
              <button type="button" disabled={disabled} className={btn} onClick={() => setEditOpen(true)}>
                修正する
              </button>
              <button type="button" disabled={disabled} className={btn} onClick={() => update(answerValidity(current, 'UNKNOWN'))}>
                まだ分からない
              </button>
            </div>
          )}
        </div>
      );
    }
    if (id === 'meaning') {
      return (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} className={btn} onClick={() => update(answerMeaning(current, 'YES'))}>
            新しく追加される売上
          </button>
          <button type="button" disabled={disabled} className={btn} onClick={() => update(answerMeaning(current, 'NO'))}>
            既存の売上に含まれる（置き換え）
          </button>
          <button type="button" disabled={disabled} className={btn} onClick={() => update(answerMeaning(current, 'UNKNOWN'))}>
            まだ分からない
          </button>
        </div>
      );
    }
    if (id === 'timing') {
      const ready = timingDraft.startYm !== '' && timingDraft.basis !== '';
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-zinc-700">効果の開始月</span>
            <input
              type="month"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
              disabled={disabled}
              value={timingDraft.startYm}
              onChange={(e) => setTimingDraft((d) => ({ ...d, startYm: e.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-zinc-700">金額の単位</span>
            <select
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
              disabled={disabled}
              value={timingDraft.basis}
              onChange={(e) => setTimingDraft((d) => ({ ...d, basis: e.target.value as '' | SpendAmountBasis }))}
            >
              <option value="">選択してください</option>
              {BASIS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={disabled || !ready}
              className={primaryBtn}
              onClick={() => update(answerTiming(current, { startYm: timingDraft.startYm as Ym, amountBasis: timingDraft.basis as SpendAmountBasis }))}
            >
              この内容で回答
            </button>
            <button type="button" disabled={disabled} className={btn} onClick={() => update(answerTiming(current, 'UNKNOWN'))}>
              まだ分からない
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-[11px] font-semibold text-zinc-700">営業利益の増分（百万円）</span>
            <input
              type="number"
              step="any"
              className="h-9 w-40 rounded-lg border border-zinc-200 bg-white px-3 text-[13px]"
              disabled={disabled}
              value={oiDraft}
              onChange={(e) => setOiDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={disabled || oiDraft.trim() === '' || !Number.isFinite(Number(oiDraft))}
            className={primaryBtn}
            onClick={() => update(answerOperatingIncome(current, Number(oiDraft)))}
          >
            回答する
          </button>
          <button type="button" disabled={disabled} className={btn} onClick={() => update(answerOperatingIncome(current, 'UNKNOWN'))}>
            まだ分からない（未算定のまま）
          </button>
        </div>
      </div>
    );
  };

  const answerSummary = (id: FinanceQuestionId): string => {
    const v = answers[id];
    if (v === undefined) return '未回答';
    if (id === 'validity') return v === 'OK' ? '妥当' : v === 'EDITED' ? '修正して確認' : 'まだ分からない';
    if (id === 'meaning') return v === 'YES' ? '新しく追加される売上' : v === 'NO' ? '既存売上に含まれる' : 'まだ分からない';
    if (id === 'timing') {
      if (v === 'UNKNOWN' || !current?.startYm || !current?.amountBasis) return 'まだ分からない';
      const basis = BASIS_OPTIONS.find((o) => o.value === current.amountBasis)?.label ?? current.amountBasis;
      return `${current.startYm}から・${basis}`;
    }
    if (typeof current?.operatingIncomeEffectYen === 'number') {
      return `${Math.round(current.operatingIncomeEffectYen / 1_000_000)}百万円の増分`;
    }
    return 'まだ分からない（未算定）';
  };

  const canConfirm = readyToConfirm(role, current);

  return (
    <section aria-label="売上・利益への効果" className="mt-4 space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        {calc ? (
          <>
            <div className="text-[11px] font-semibold text-blue-900">AIの見込み（{calc.resultLabel}）</div>
            <div className="mt-1 text-[22px] font-bold text-zinc-950">
              {calc.resultValue}
              <span className="ml-1 text-[11px] font-semibold text-zinc-500">百万円</span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-700">計算式：{calc.formula}</div>
            <div className="mt-1 text-[11px] text-zinc-700">前提の出所：{originText}</div>
          </>
        ) : (
          current && result.formula ? (
            <div className="space-y-1 text-[12px] text-zinc-700">
              <div>登録済みの見込み：{amountMil ?? '—'}百万円（詳細設定で入力した金額）</div>
              <div className="text-[11px]">計算式：{result.formula}</div>
            </div>
          ) : (
            <div className="text-[12px] text-zinc-700">前提の数字を入れると、AIが見込みと計算式を示します。計算式が合わない場合は、詳細設定で直接金額を入力できます。</div>
          )
        )}

        {!current && calc && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-zinc-700">この見込みを未確認の財務効果として登録すると、次に確認する質問が出ます。登録しただけでは財務試算には入りません。</p>
            <button type="button" disabled={disabled} className={primaryBtn} onClick={onCreateCandidate}>
              この案を財務効果の候補にする
            </button>
          </div>
        )}
        {notice && <p className="mt-2 text-[11px] text-blue-900">{notice}</p>}
      </div>

      {current && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          {question && deferQuestions ? (
            <p className="text-[12px] text-zinc-700">上の「AIからの確認事項」に回答（または保留）するか、「後で確認して、財務の質問へ進む」を押すと、ここに財務の質問が出ます。</p>
          ) : question ? (
            <div className="space-y-3">
              <div className="text-[11px] font-semibold text-zinc-500">
                質問 {questionNumber} / {plan.length}
                {question === 'operatingIncome' && '（任意）'}
              </div>
              <div className="text-[14px] font-semibold text-zinc-900">{questionText(question)}</div>
              {renderQuestion(question)}
              {question === 'operatingIncome' && canConfirm && (
                <button
                  type="button"
                  disabled={disabled}
                  className={btn}
                  onClick={() => update({ ...answerOperatingIncome(current, 'UNKNOWN'), confirmed: true })}
                >
                  営業利益は未算定のまま、内容を確認する
                </button>
              )}
              <p className="text-[11px] text-zinc-500">分からないときは「まだ分からない」を選んでください。数字は入れず、確認が必要な項目として残ります。</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[12px] font-semibold text-zinc-900">
                {canConfirm || current.confirmed ? '回答がそろいました。内容を確認すると、STAGE6の財務試算に反映されます。' : '確認できるまで、未回答の項目を埋めてください。'}
              </div>
              {!current.confirmed && (
                <button type="button" disabled={disabled || !canConfirm} className={primaryBtn} onClick={() => update({ ...current, confirmed: true })}>
                  内容を確認し、確認済みにする
                </button>
              )}
              {current.confirmed && (
                <button type="button" disabled={disabled} className={btn} onClick={() => update({ ...current, confirmed: false })}>
                  確認を取り消す
                </button>
              )}
            </div>
          )}

          <ul className="mt-4 divide-y divide-zinc-100 border-t border-zinc-100 text-[12px]">
            {plan.map((id) => {
              const answered = answers[id] !== undefined;
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-zinc-800">{QUESTION_TITLE[id]}：</span>
                    <span className={answered && answers[id] !== 'UNKNOWN' ? 'text-zinc-800' : 'text-amber-800'}>{answerSummary(id)}</span>
                    {answers[id] === 'UNKNOWN' && <div className="text-[11px] text-zinc-600">調べること：{RESEARCH_HINT[id]}</div>}
                  </div>
                  {answered && (
                    <button type="button" disabled={disabled} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800 disabled:opacity-50" onClick={() => update(resetAnswer(current, id))}>
                      回答を変える
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {stage6Note && <p className="mt-3 text-[11px] text-zinc-700">財務試算への反映：{vm.statusLabel}。{stage6Note}</p>}
        </div>
      )}

      {calc && (
        <details className="rounded-xl border border-zinc-200 bg-zinc-50 p-3" open={editOpen} onToggle={(e) => setEditOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-[12px] font-semibold text-zinc-800">前提の数値を修正する</summary>
          <div className="mt-3">{assumptionEditor}</div>
        </details>
      )}

      <details className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-zinc-800">詳細設定（算定方法・根拠・重複・効果の種類）</summary>
        <div className="mt-3">{detailsSlot}</div>
      </details>
    </section>
  );
}
