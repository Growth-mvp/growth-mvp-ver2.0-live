import {
  applyFinanceAnswers,
  confirmBlockers,
  financeConfirmContext,
  initialFinanceAnswers,
  periodOutsidePlanNote,
  type FinanceAnswers,
  type FinanceAnswersByKind,
  type FinanceDraftKind,
  type FinanceEffectDraft,
  type PlanPeriod,
} from '@/lib/stage4/planView/financeBridge';
import { computeFinanceEffect, FINANCE_EFFECT_BASIS_LABEL, isFinanceEffectMaterialChange } from '@/lib/financeEffect';
import { formatYenScaled } from '@/utils/yenScale';
import type { FinanceEffect, SpendAmountBasis } from '@/types/strategy';

const BASES: SpendAmountBasis[] = ['TOTAL', 'MONTHLY', 'ANNUAL'];

type RevisionHandlers = {
  revising: boolean;
  onStartRevise?: () => void;
  onCancelRevise?: () => void;
  onUnconfirm?: () => void;
};

const amountText = (yen: number | undefined): string => (yen === undefined ? '未入力' : formatYenScaled(yen));

function formulaOf(draft: FinanceEffectDraft): string {
  const e = draft.base;
  if (e.kind === 'REVENUE_UP' && e.method === 'QUANTITY_UNIT_PRICE') {
    return `${e.quantity}件（月額）× ${amountText(e.unitPriceYen)}`;
  }
  if (e.kind === 'REVENUE_UP') {
    return `${e.meetingsPerPeriod}社 × ${e.winRatePct}% × ${amountText(e.averageDealYen)}`;
  }
  return amountText(e.directAmountYen);
}

function statusOf(saved: FinanceEffect | undefined, revising: boolean): string {
  if (!saved) return '未保存（STAGE6の試算には入りません）';
  if (saved.confirmed && revising) return '修正中（保存するまで、確認済みの内容のままです）';
  if (saved.confirmed) return '確認済み（STAGE6の試算に入ります）';
  return '草案（未確認のため、STAGE6の試算には入りません）';
}

function DraftCard({
  draft,
  saved,
  answers,
  ctx,
  planPeriod,
  writable,
  onChange,
  revising,
  onStartRevise,
  onCancelRevise,
  onUnconfirm,
  addCostYen,
}: {
  draft: FinanceEffectDraft;
  saved: FinanceEffect | undefined;
  answers: FinanceAnswers;
  ctx: ReturnType<typeof financeConfirmContext>;
  planPeriod: PlanPeriod | null;
  writable: boolean;
  onChange: (answers: FinanceAnswers) => void;
  /** 同じ試算の追加費用（円）。未入力なら undefined（0とはみなさない） */
  addCostYen?: number;
} & RevisionHandlers) {
  const candidate = applyFinanceAnswers(draft, answers);
  const blockers = confirmBlockers(candidate, ctx);
  const isRevenue = draft.kind === 'REVENUE_UP';
  const isCost = draft.kind === 'COST_REDUCTION';
  const isService = draft.base.method === 'QUANTITY_UNIT_PRICE';
  const annual = computeFinanceEffect(candidate);
  const opBasis = isService ? 'MONTHLY' : answers.amountBasis;
  const opBasisText = opBasis ? FINANCE_EFFECT_BASIS_LABEL[opBasis] : '売上の単位を先に選ぶ';
  const grossYen =
    annual.annualRevenueYen !== undefined && candidate.costRatePct !== undefined
      ? annual.annualRevenueYen * (1 - candidate.costRatePct / 100)
      : undefined;
  const confirmedNow = saved?.confirmed === true;
  const locked = confirmedNow && !revising;
  const disabled = !writable || locked;
  const differs = confirmedNow && !revising && isFinanceEffectMaterialChange(saved, candidate);
  const set = (patch: Partial<FinanceAnswers>) => onChange({ ...answers, ...patch });
  const periodNote = periodOutsidePlanNote(candidate, planPeriod);

  return (
    <div className="plan-param" aria-label={`${draft.label}の財務効果`}>
      <div>
        <strong>{draft.label}</strong>：{formulaOf(draft)}
      </div>
      <div className="plan-note">状態：{statusOf(saved, revising)}</div>
      {confirmedNow && !revising && onStartRevise && (
        <div className="plan-actions">
          <button type="button" disabled={!writable} onClick={onStartRevise}>
            修正する
          </button>
          {onUnconfirm && (
            <button type="button" disabled={!writable} onClick={onUnconfirm}>
              確認を解除する
            </button>
          )}
        </div>
      )}
      {revising && (
        <div className="plan-actions">
          <p className="plan-note">修正中です。「計画を保存」で修正内容を保存し、確認し直します。それまでSTAGE6の金額は変わりません。</p>
          {onCancelRevise && (
            <button type="button" onClick={onCancelRevise}>
              修正をやめる
            </button>
          )}
        </div>
      )}
      {differs && (
        <p role="note" className="plan-note">
          確認済みの内容と、現在の前提の試算が違います。修正して確認し直すと、STAGE6に反映されます（それまでSTAGE6は確認済みの内容のままです）。
        </p>
      )}
      <div className="plan-note">金額の単位：円</div>
      {isCost && <div className="plan-note">発生頻度：年額（削減対象は年間費用のため、年額で固定します）</div>}
      {isService && <div className="plan-note">発生頻度：月額（顧客数×1社当たり月間配送件数×1件当たり料金で計算します）</div>}
      {!isCost && !isService && (
      <label>
        発生頻度（年度換算に使います）
        <select
          aria-label={`${draft.label}の発生頻度`}
          value={answers.amountBasis ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const basis = (e.target.value || undefined) as SpendAmountBasis | undefined;
            set({ amountBasis: basis, ...(basis === 'TOTAL' ? { endYm: '' } : {}) });
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
      )}
      <label>
        開始年月
        <input
          type="month"
          aria-label={`${draft.label}の開始年月`}
          value={answers.startYm ?? ''}
          disabled={disabled}
          onChange={(e) => set({ startYm: e.target.value })}
        />
      </label>
      <label>
        {answers.amountBasis === 'TOTAL' ? '終了年月（一回限りは入力しません）' : '終了年月（未入力だと後の年度まで計上されます）'}
        <input
          type="month"
          aria-label={`${draft.label}の終了年月`}
          value={answers.endYm ?? ''}
          disabled={disabled || answers.amountBasis === 'TOTAL'}
          onChange={(e) => set({ endYm: e.target.value })}
        />
      </label>
      {isRevenue && (
        <label>
          営業利益増分（{opBasisText}・百万円・任意）
          <input
            type="number"
            inputMode="decimal"
            step="any"
            aria-label={`${draft.label}の営業利益の増分`}
            disabled={disabled}
            value={answers.operatingIncomeEffectYen === undefined ? '' : answers.operatingIncomeEffectYen / 1_000_000}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const n = raw === '' ? undefined : Number(raw);
              set({ operatingIncomeEffectYen: n === undefined || !Number.isFinite(n) ? undefined : n * 1_000_000 });
            }}
          />
        </label>
      )}
      {isRevenue && isService && <div className="plan-note">売上の区分：サービス提供（役務）</div>}
      {isRevenue && !isService && (
        <label>
          売上の区分
          <select
            aria-label={`${draft.label}の売上の区分`}
            value={answers.revenueKind ?? ''}
            disabled={disabled}
            onChange={(e) => set({ revenueKind: (e.target.value || undefined) as FinanceAnswers['revenueKind'] })}
          >
            <option value="">未回答</option>
            <option value="PAID_DEVELOPMENT">有償開発（開発費の受注）</option>
            <option value="MASS_PRODUCTION">量産（製品の販売）</option>
          </select>
        </label>
      )}
      {isRevenue && annual.annualOperatingEffectYen !== undefined && (
        <p className="plan-note">
          営業利益増分の年額：{amountText(annual.annualOperatingEffectYen)}（年額の売上 {amountText(annual.annualRevenueYen)}
          {grossYen !== undefined ? `、売上の粗利 ${amountText(grossYen)}（原価率${candidate.costRatePct}%）` : ''}）
        </p>
      )}
      {isRevenue && answers.operatingIncomeEffectYen !== undefined && ctx.hasCostEffect && (
        <label>
          営業利益増分は、同じ案件の追加費用を差し引いた後の値ですか
          <select
            aria-label={`${draft.label}の営業利益増分と追加費用`}
            value={answers.opIncomeIncludesAddCost === undefined ? '' : answers.opIncomeIncludesAddCost ? 'yes' : 'no'}
            disabled={disabled}
            onChange={(e) => set({ opIncomeIncludesAddCost: e.target.value === '' ? undefined : e.target.value === 'yes' })}
          >
            <option value="">未回答</option>
            <option value="yes">含む（追加費用を差し引いた後）</option>
            <option value="no">含まない（追加費用は別に差し引く）</option>
          </select>
        </label>
      )}
      {isCost && (
        <>
          <label>
            <input
              type="checkbox"
              aria-label={`${draft.label}の削減の確認`}
              checked={answers.reductionConfirmed === true}
              disabled={disabled}
              onChange={(e) => set({ reductionConfirmed: e.target.checked })}
            />
            実際に減らせる費用として確認できた（費用配賦の見直し・作業時間短縮だけでは計上しない）
          </label>
          <p className="plan-note">
            {addCostYen === undefined || candidate.directAmountYen === undefined
              ? '追加費用が未入力のため、年間利益改善額は算出しません（追加費用は別の効果として入力します）。'
              : `年間利益改善額＝年間削減額 ${amountText(candidate.directAmountYen)} − 追加費用 ${amountText(addCostYen)} ＝ ${amountText(candidate.directAmountYen - addCostYen)}`}
          </p>
        </>
      )}
      {(ctx.overlapCount > 0 || (isCost && ctx.revenueHasOperatingEffect === true)) && (
        <label>
          {isCost && ctx.overlapCount === 0
            ? '同じ案件の売上増加で営業利益増分を計上しています。コスト削減との重複がないことの説明'
            : `同じ効果の可能性がある他の施策（${ctx.overlapCount}件）について、重複していない理由`}
          <textarea
            aria-label={`${draft.label}の重複の説明`}
            value={answers.overlapNote ?? ''}
            disabled={disabled}
            onChange={(e) => set({ overlapNote: e.target.value })}
          />
        </label>
      )}
      {periodNote && (
        <p role="note" className="plan-note">
          {periodNote}
        </p>
      )}
      {!locked && blockers.length > 0 && <p className="plan-note">未確認の項目：{blockers.join('、')}</p>}
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
  answers,
  onAnswer,
  revising = [],
  onStartRevise,
  onCancelRevise,
  onUnconfirm,
}: {
  drafts: FinanceEffectDraft[];
  saved: FinanceEffect[];
  overlapCount: number;
  planPeriod?: PlanPeriod | null;
  writable: boolean;
  reasonNotWritable?: string;
  answers: FinanceAnswersByKind;
  onAnswer: (kind: FinanceEffectDraft['kind'], answers: FinanceAnswers) => void;
  revising?: FinanceDraftKind[];
  onStartRevise?: (kind: FinanceDraftKind) => void;
  onCancelRevise?: (kind: FinanceDraftKind) => void;
  onUnconfirm?: (kind: FinanceDraftKind) => void;
}) {
  const ctx = financeConfirmContext(drafts, saved, overlapCount, answers);
  const addCostYen = drafts.find((d) => d.kind === 'COST_INCREASE')?.base.directAmountYen;
  return (
    <section aria-labelledby="stage4-finance-confirm" className="plan-impact-estimate">
      <h3 id="stage4-finance-confirm" className="plan-h3">
        財務効果（STAGE6へ反映）
      </h3>
      <p className="plan-note">
        入力して「計画を保存」を押すと、財務効果もまとめて保存されます。必須項目がそろったものだけ確認済みとなり、STAGE6に反映されます。投資額は投資計画で扱うため、ここでは確認しません。
      </p>
      {planPeriod && (
        <p className="plan-note">
          計画期間：{planPeriod.startYm}〜{planPeriod.endYm}
        </p>
      )}
      {!writable && reasonNotWritable && <p className="plan-note">{reasonNotWritable}</p>}
      {drafts.length === 0 && <p className="plan-note">財務効果の案は、参考試算の数値がそろうと表示されます。</p>}
      {drafts.map((draft) => {
        const savedOne = saved.find((e) => e.kind === draft.kind);
        return (
          <DraftCard
            key={`${draft.kind}|${JSON.stringify(draft.base)}`}
            draft={draft}
            saved={savedOne}
            answers={answers[draft.kind] ?? initialFinanceAnswers(draft, savedOne)}
            ctx={ctx}
            planPeriod={planPeriod}
            writable={writable}
            onChange={(a) => onAnswer(draft.kind, a)}
            revising={revising.includes(draft.kind)}
            onStartRevise={onStartRevise ? () => onStartRevise(draft.kind) : undefined}
            onCancelRevise={onCancelRevise ? () => onCancelRevise(draft.kind) : undefined}
            onUnconfirm={onUnconfirm ? () => onUnconfirm(draft.kind) : undefined}
            addCostYen={addCostYen}
          />
        );
      })}
    </section>
  );
}
