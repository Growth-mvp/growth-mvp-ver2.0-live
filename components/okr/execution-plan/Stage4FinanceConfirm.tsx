import { useState } from 'react';

import { FINANCE_EFFECT_BASIS_LABEL } from '@/lib/financeEffect';
import {
  applyFinanceAnswers,
  confirmBlockers,
  periodOutsidePlanNote,
  type ConfirmContext,
  type FinanceAnswers,
  type FinanceEffectDraft,
  type FinanceWriteAction,
  type PlanPeriod,
} from '@/lib/stage4/planView/financeBridge';
import type { FinanceWriteResult } from '@/lib/stage4/planView/financeBridgeStore';
import type { FinanceEffect, SpendAmountBasis } from '@/types/strategy';

const BASES: SpendAmountBasis[] = ['TOTAL', 'MONTHLY', 'ANNUAL'];

const millionText = (yen: number | undefined): string => (yen === undefined ? '未入力' : `${Math.round(yen / 1_000_000 * 10) / 10}百万円`);

function formulaOf(draft: FinanceEffectDraft): string {
  const e = draft.base;
  if (e.kind === 'REVENUE_UP') {
    return `${e.meetingsPerPeriod}社 × ${e.winRatePct}% × ${millionText(e.averageDealYen)}`;
  }
  return millionText(e.directAmountYen);
}

function statusOf(saved: FinanceEffect | undefined): string {
  if (!saved) return '未保存（STAGE6の試算には入りません）';
  if (saved.confirmed) return '確認済み（STAGE6の試算に入ります）';
  return '草案として保存済み（未確認のため、STAGE6の試算には入りません）';
}

function DraftCard({
  draft,
  saved,
  ctx,
  planPeriod,
  writable,
  onWrite,
}: {
  draft: FinanceEffectDraft;
  saved: FinanceEffect | undefined;
  ctx: ConfirmContext;
  planPeriod: PlanPeriod | null;
  writable: boolean;
  onWrite: (candidate: FinanceEffect, action: FinanceWriteAction) => Promise<FinanceWriteResult>;
}) {
  const [answers, setAnswers] = useState<FinanceAnswers>(() =>
    saved
      ? {
          amountBasis: saved.amountBasis,
          startYm: saved.startYm ?? '',
          endYm: saved.endYm ?? '',
          meetingBasisConfirmed: saved.meetingBasisConfirmed,
          isIncremental: saved.isIncremental,
          operatingIncomeEffectYen: saved.operatingIncomeEffectYen,
          opIncomeIncludesAddCost: saved.opIncomeIncludesAddCost,
          revenueKind: saved.revenueKind,
          overlapNote: saved.overlapNote,
        }
      : { startYm: draft.base.startYm ?? '', endYm: draft.base.endYm ?? '' },
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const candidate = applyFinanceAnswers(draft, answers);
  const blockers = confirmBlockers(candidate, ctx);
  const overlapCount = ctx.overlapCount;
  const isRevenue = draft.kind === 'REVENUE_UP';
  const aiSource = draft.base.source === 'AI_PROPOSED';
  const locked = saved?.confirmed === true;

  const run = async (action: FinanceWriteAction) => {
    setBusy(true);
    setMessage(null);
    const result = await onWrite(candidate, action);
    setBusy(false);
    setMessage(result.ok ? (action === 'CONFIRM' ? '確認しました。STAGE6の試算に反映されます。' : '草案として保存しました。') : result.message);
  };

  return (
    <div className="plan-param" aria-label={`${draft.label}の財務効果`}>
      <div>
        <strong>{draft.label}</strong>：{formulaOf(draft)}
      </div>
      <div className="plan-note">状態：{statusOf(saved)}</div>
      <label>
        金額の単位
        <select
          aria-label={`${draft.label}の金額の単位`}
          value={answers.amountBasis ?? ''}
          disabled={!writable || locked}
          onChange={(e) => {
            const basis = (e.target.value || undefined) as SpendAmountBasis | undefined;
            setAnswers((a) => ({ ...a, amountBasis: basis, ...(basis === 'TOTAL' ? { endYm: '' } : {}) }));
          }}
        >
          <option value="">選んでください</option>
          {BASES.map((b) => (
            <option key={b} value={b}>
              {FINANCE_EFFECT_BASIS_LABEL[b]}
            </option>
          ))}
        </select>
      </label>
      <label>
        開始年月
        <input
          type="month"
          aria-label={`${draft.label}の開始年月`}
          value={answers.startYm ?? ''}
          disabled={!writable || locked}
          onChange={(e) => setAnswers((a) => ({ ...a, startYm: e.target.value }))}
        />
      </label>
      <label>
        {answers.amountBasis === 'TOTAL'
          ? '終了年月（一回限りは入力しません。開始月に全額計上します）'
          : '終了年月（必須。未入力だと後の年度まで計上されます）'}
        <input
          type="month"
          aria-label={`${draft.label}の終了年月`}
          value={answers.endYm ?? ''}
          disabled={!writable || locked || answers.amountBasis === 'TOTAL'}
          onChange={(e) => setAnswers((a) => ({ ...a, endYm: e.target.value }))}
        />
      </label>
      {isRevenue && aiSource && (
        <label>
          <input
            type="checkbox"
            checked={answers.meetingBasisConfirmed === true}
            disabled={!writable || locked}
            onChange={(e) => setAnswers((a) => ({ ...a, meetingBasisConfirmed: e.target.checked }))}
          />
          AIの「対象の顧客数」を、商談数として扱ってよい
        </label>
      )}
      {isRevenue && (
        <label>
          <input
            type="checkbox"
            checked={answers.isIncremental === true}
            disabled={!writable || locked}
            onChange={(e) => setAnswers((a) => ({ ...a, isIncremental: e.target.checked }))}
          />
          既存の売上に対する追加効果である
        </label>
      )}
      {isRevenue && (
        <label>
          売上増加に伴う営業利益の増分（百万円・任意。未入力なら営業利益は未算定）
          <input
            type="number"
            inputMode="decimal"
            step="any"
            aria-label={`${draft.label}の営業利益の増分`}
            disabled={!writable || locked}
            value={answers.operatingIncomeEffectYen === undefined ? '' : answers.operatingIncomeEffectYen / 1_000_000}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const n = raw === '' ? undefined : Number(raw);
              setAnswers((a) => ({ ...a, operatingIncomeEffectYen: n === undefined || !Number.isFinite(n) ? undefined : n * 1_000_000 }));
            }}
          />
        </label>
      )}
      {isRevenue && (
        <label>
          売上の区分
          <select
            aria-label={`${draft.label}の売上の区分`}
            value={answers.revenueKind ?? ''}
            disabled={!writable || locked}
            onChange={(e) =>
              setAnswers((a) => ({
                ...a,
                revenueKind: (e.target.value || undefined) as FinanceAnswers['revenueKind'],
              }))
            }
          >
            <option value="">未回答</option>
            <option value="PAID_DEVELOPMENT">有償開発（開発費の受注）</option>
            <option value="MASS_PRODUCTION">量産（製品の販売）</option>
          </select>
        </label>
      )}
      {isRevenue && answers.operatingIncomeEffectYen !== undefined && ctx.hasCostEffect && (
        <label>
          営業利益増分は、同じ案件の追加費用を差し引いた後の値ですか（STAGE3の本文には、追加費用を差し引いた営業利益増分として書かれている例もあります）
          <select
            aria-label={`${draft.label}の営業利益増分と追加費用`}
            value={answers.opIncomeIncludesAddCost === undefined ? '' : answers.opIncomeIncludesAddCost ? 'yes' : 'no'}
            disabled={!writable || locked}
            onChange={(e) =>
              setAnswers((a) => ({
                ...a,
                opIncomeIncludesAddCost: e.target.value === '' ? undefined : e.target.value === 'yes',
              }))
            }
          >
            <option value="">未回答</option>
            <option value="yes">含む（追加費用を差し引いた後。追加費用は別に差し引かない）</option>
            <option value="no">含まない（追加費用は別に差し引く）</option>
          </select>
        </label>
      )}
      {overlapCount > 0 && (
        <label>
          同じ効果の可能性がある他の施策（{overlapCount}件）について、重複していない理由
          <textarea
            aria-label={`${draft.label}の重複の説明`}
            value={answers.overlapNote ?? ''}
            disabled={!writable || locked}
            onChange={(e) => setAnswers((a) => ({ ...a, overlapNote: e.target.value }))}
          />
        </label>
      )}
      {periodOutsidePlanNote(candidate, planPeriod) && (
        <p role="note" className="plan-note">{periodOutsidePlanNote(candidate, planPeriod)}</p>
      )}
      <div className="plan-toolbar">
        <button type="button" className="plan-btn-quiet" disabled={!writable || locked || busy} onClick={() => run('SAVE_DRAFT')}>
          草案として保存
        </button>
        <button
          type="button"
          className="plan-btn-primary"
          disabled={!writable || locked || busy || blockers.length > 0 || !saved}
          onClick={() => run('CONFIRM')}
        >
          この内容を財務効果として確認
        </button>
      </div>
      {!locked && blockers.length > 0 && <p className="plan-note">確認するには：{blockers.join('、')}</p>}
      {message && <p role="status" className="plan-note">{message}</p>}
    </div>
  );
}

export function Stage4FinanceConfirm({
  drafts,
  saved,
  overlapCount,
  planPeriod = null,
  writable,
  reasonNotWritable,
  onWrite,
}: {
  drafts: FinanceEffectDraft[];
  saved: FinanceEffect[];
  overlapCount: number;
  planPeriod?: PlanPeriod | null;
  writable: boolean;
  reasonNotWritable?: string;
  onWrite: (candidate: FinanceEffect, action: FinanceWriteAction) => Promise<FinanceWriteResult>;
}) {
  const revenueSaved = saved.find((e) => e.kind === 'REVENUE_UP');
  const costSaved = saved.find((e) => e.kind === 'COST_INCREASE');
  const ctx: ConfirmContext = {
    overlapCount,
    hasCostEffect: drafts.some((d) => d.kind === 'COST_INCREASE') || !!costSaved,
    costConfirmed: costSaved?.confirmed === true,
    revenueOpIncludesAddCost:
      revenueSaved?.opIncomeIncludesAddCost === true && typeof revenueSaved.operatingIncomeEffectYen === 'number',
  };
  return (
    <section aria-labelledby="stage4-finance-confirm" className="plan-impact-estimate">
      <h3 id="stage4-finance-confirm" className="plan-h3">
        財務効果の確認（STAGE6へ反映）
      </h3>
      <p className="plan-note">
        参考試算の数値から、財務効果の草案を作ります。内容を確認して「確認」を押したものだけ、STAGE6のPL・CFに反映されます。投資額は財務効果ではなく投資計画で扱うため、ここでは確認しません。
      </p>
      {planPeriod && (
        <p className="plan-note">
          実行計画の期間：{planPeriod.startYm}〜{planPeriod.endYm}（参考。計上期間は利用者が入力し、自動では設定しません）
        </p>
      )}
      {!writable && reasonNotWritable && <p className="plan-note">{reasonNotWritable}</p>}
      {drafts.length === 0 && <p className="plan-note">財務効果の草案は、参考試算の数値がそろうと表示されます。</p>}
      {drafts.map((draft) => (
        <DraftCard
          key={`${draft.kind}|${JSON.stringify(draft.base)}`}
          draft={draft}
          saved={saved.find((e) => e.kind === draft.kind)}
          ctx={ctx}
          planPeriod={planPeriod}
          writable={writable}
          onWrite={onWrite}
        />
      ))}
    </section>
  );
}
