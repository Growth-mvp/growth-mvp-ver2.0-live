import {
  applyFinanceAnswers,
  confirmBlockers,
  financeConfirmContext,
  initialFinanceAnswers,
  periodOutsidePlanNote,
  type FinanceAnswers,
  type FinanceAnswersByKind,
  type FinanceEffectDraft,
  type FinanceOverlapOf,
  type PlanPeriod,
} from '@/lib/stage4/planView/financeBridge';
import { computeFinanceEffect, FINANCE_EFFECT_BASIS_LABEL, isFinanceEffectMaterialChange } from '@/lib/financeEffect';
import { formatYenScaled } from '@/utils/yenScale';
import type { FinanceEffect, SpendAmountBasis } from '@/types/strategy';

const BASES: SpendAmountBasis[] = ['TOTAL', 'MONTHLY', 'ANNUAL'];

const amountText = (yen: number | undefined): string => (yen === undefined ? '未入力' : formatYenScaled(yen));

const numberOrUndefined = (text: string): number | undefined => {
  const t = text.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function formulaOf(draft: FinanceEffectDraft): string {
  if (draft.blank) return '金額を入力してください';
  const e = draft.base;
  if (e.kind === 'REVENUE_UP' && e.method === 'QUANTITY_UNIT_PRICE') {
    return `${e.quantity}件（月額）× ${amountText(e.unitPriceYen)}`;
  }
  if (e.kind === 'REVENUE_UP') {
    return `${e.meetingsPerPeriod}社 × ${e.winRatePct}% × ${amountText(e.averageDealYen)}`;
  }
  return amountText(e.directAmountYen);
}

function statusOf(saved: FinanceEffect | undefined, changed: boolean, held: boolean): string {
  if (!saved) return '未設定';
  if (changed) return '未保存（入力を変更中）';
  if (saved.confirmed) return '保存済み・STAGE6に反映';
  return held ? '重複の可能性があるため計上保留' : '入力不足のため未算定';
}

const isOverlapReason = (reason: string): boolean => reason.includes('重複');

function DraftCard({
  draft,
  saved,
  answers,
  baseCtx,
  overlapOf,
  planPeriod,
  writable,
  onChange,
  addCostYen,
}: {
  draft: FinanceEffectDraft;
  saved: FinanceEffect | undefined;
  answers: FinanceAnswers;
  baseCtx: ReturnType<typeof financeConfirmContext>;
  overlapOf: FinanceOverlapOf;
  planPeriod: PlanPeriod | null;
  writable: boolean;
  onChange: (answers: FinanceAnswers) => void;
  /** 同じ試算の追加費用（円）。未入力なら undefined（0とはみなさない） */
  addCostYen?: number;
}) {
  const candidate = applyFinanceAnswers(draft, answers);
  const ctx: ReturnType<typeof financeConfirmContext> = { ...baseCtx, overlaps: overlapOf(candidate) };
  const blockers = confirmBlockers(candidate, ctx);
  const isRevenue = draft.kind === 'REVENUE_UP';
  const isCost = draft.kind === 'COST_REDUCTION';
  const isService = candidate.method === 'QUANTITY_UNIT_PRICE';
  const costRateMode = isCost && (answers.costInputMode ?? (candidate.reductionBaseYen !== undefined ? 'RATE' : 'DIRECT')) === 'RATE';
  const costDirectMode = isCost && !costRateMode;
  const annual = computeFinanceEffect(candidate, { projectHasCostIncrease: ctx.costConfirmed });
  const opBasis = candidate.amountBasis;
  const opBasisText = opBasis ? FINANCE_EFFECT_BASIS_LABEL[opBasis] : '売上の単位を先に選ぶ';
  const confirmedNow = saved?.confirmed === true;
  const disabled = !writable;
  const differs = confirmedNow && isFinanceEffectMaterialChange(saved, candidate);
  const set = (patch: Partial<FinanceAnswers>) => onChange({ ...answers, ...patch });
  const periodNote = periodOutsidePlanNote(candidate, planPeriod);

  return (
    <div className="plan-param" aria-label={`${draft.label}の財務効果`}>
      <div>
        <strong>{draft.label}</strong>：{formulaOf(draft)}
      </div>
      <div className="plan-note">状態：{statusOf(saved, differs, blockers.some(isOverlapReason))}</div>
      {!confirmedNow && blockers.filter(isOverlapReason).length > 0 && (
        <p className="plan-note">重複の可能性があるため計上保留：{blockers.filter(isOverlapReason).join('、')}</p>
      )}
      {!confirmedNow && blockers.some((b) => !isOverlapReason(b)) && (
        <p className="plan-note">入力不足のため未算定：{blockers.filter((b) => !isOverlapReason(b)).join('、')}</p>
      )}
      {!confirmedNow && blockers.length === 0 && (
        <p className="plan-note">計算に必要な項目はそろっています。「計画を保存」でSTAGE6に反映されます。</p>
      )}
      {differs && (
        <p role="note" className="plan-note">
          入力を変えています（未保存）。「計画を保存」でSTAGE6に反映されます。
        </p>
      )}
      <div className="plan-note">金額の単位：円</div>
      {(isRevenue || isCost) && (
        <label>
          計算方式
          <select
            aria-label={`${draft.label}の計算方式`}
            value={isRevenue ? (candidate.method ?? '') : costRateMode ? 'RATE' : 'DIRECT'}
            disabled={disabled}
            onChange={(e) =>
              set(isRevenue ? { method: e.target.value as FinanceEffect['method'] } : { costInputMode: e.target.value as 'RATE' | 'DIRECT' })
            }
          >
            {isRevenue ? (
              <>
                <option value="DIRECT_AMOUNT">金額を直接入力</option>
                <option value="FUNNEL">商談数×受注率×平均受注額</option>
                <option value="QUANTITY_UNIT_PRICE">サービス提供（顧客数×件数×単価）</option>
              </>
            ) : (
              <>
                <option value="RATE">削減対象の費用×想定削減率</option>
                <option value="DIRECT">年間削減額を直接入力</option>
              </>
            )}
          </select>
        </label>
      )}
      {costRateMode && (
        <>
          <label>
            削減対象の年間費用（百万円）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-label={`${draft.label}の削減対象の年間費用`}
              disabled={disabled}
              value={candidate.reductionBaseYen === undefined ? '' : candidate.reductionBaseYen / 1_000_000}
              onChange={(e) => {
                const n = numberOrUndefined(e.target.value);
                set({ reductionBaseYen: n === undefined ? undefined : Math.round(n * 1_000_000) });
              }}
            />
          </label>
          <label>
            想定削減率（%）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              max={100}
              aria-label={`${draft.label}の想定削減率`}
              disabled={disabled}
              value={candidate.reductionRatePct ?? ''}
              onChange={(e) => set({ reductionRatePct: numberOrUndefined(e.target.value) })}
            />
          </label>
          <p className="plan-note">
            年間削減額＝
            {candidate.reductionBaseYen === undefined || candidate.reductionRatePct === undefined
              ? '未入力（削減対象の年間費用と想定削減率を入れると自動で計算します）'
              : `${candidate.reductionBaseYen / 1_000_000}百万円 × ${candidate.reductionRatePct}% ＝ ${amountText(candidate.directAmountYen)}`}
          </p>
        </>
      )}
      {costDirectMode && (
        <label>
          年間削減額（百万円）
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-label={`${draft.label}の年間削減額`}
            disabled={disabled}
            value={candidate.directAmountYen === undefined ? '' : candidate.directAmountYen / 1_000_000}
            onChange={(e) => {
              const n = numberOrUndefined(e.target.value);
              set({ directAmountYen: n === undefined ? undefined : Math.round(n * 1_000_000) });
            }}
          />
        </label>
      )}
      {isRevenue && candidate.method === 'DIRECT_AMOUNT' && (
        <label>
          売上の金額（百万円）
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-label={`${draft.label}の売上の金額`}
            disabled={disabled}
            value={candidate.directAmountYen === undefined ? '' : candidate.directAmountYen / 1_000_000}
            onChange={(e) => {
              const n = numberOrUndefined(e.target.value);
              set({ directAmountYen: n === undefined ? undefined : Math.round(n * 1_000_000) });
            }}
          />
        </label>
      )}
      {isRevenue && candidate.method === 'QUANTITY_UNIT_PRICE' && (
        <>
          <label>
            顧客数（社）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-label={`${draft.label}の顧客数`}
              disabled={disabled}
              value={candidate.serviceCustomers ?? ''}
              onChange={(e) => set({ serviceCustomers: numberOrUndefined(e.target.value) })}
            />
          </label>
          <label>
            1社当たり月間件数
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-label={`${draft.label}の1社当たり件数`}
              disabled={disabled}
              value={candidate.servicePerCustomerCount ?? ''}
              onChange={(e) => set({ servicePerCustomerCount: numberOrUndefined(e.target.value) })}
            />
          </label>
          <label>
            1件当たり単価（円）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-label={`${draft.label}の単価`}
              disabled={disabled}
              value={candidate.unitPriceYen ?? ''}
              onChange={(e) => set({ unitPriceYen: numberOrUndefined(e.target.value) })}
            />
          </label>
        </>
      )}
      {isRevenue && candidate.method === 'FUNNEL' && (
        <>
          <label>
            商談数（社）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-label={`${draft.label}の商談数`}
              disabled={disabled}
              value={candidate.meetingsPerPeriod ?? ''}
              onChange={(e) => set({ meetingsPerPeriod: numberOrUndefined(e.target.value) })}
            />
          </label>
          <label>
            受注率（%）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              max={100}
              aria-label={`${draft.label}の受注率`}
              disabled={disabled}
              value={candidate.winRatePct ?? ''}
              onChange={(e) => set({ winRatePct: numberOrUndefined(e.target.value) })}
            />
          </label>
          <label>
            平均受注額（百万円）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-label={`${draft.label}の平均受注額`}
              disabled={disabled}
              value={candidate.averageDealYen === undefined ? '' : candidate.averageDealYen / 1_000_000}
              onChange={(e) => {
                const n = numberOrUndefined(e.target.value);
                set({ averageDealYen: n === undefined ? undefined : Math.round(n * 1_000_000) });
              }}
            />
          </label>
        </>
      )}
      {isCost && <div className="plan-note">発生頻度：年額（削減対象は年間費用のため、年額で固定します）</div>}
      {isService && <div className="plan-note">発生頻度：月額（顧客数×1社当たり月間配送件数×1件当たり料金で計算します）</div>}
      {!isCost && (
      <label>
        発生頻度（年度換算に使います）
        <select
          aria-label={`${draft.label}の発生頻度`}
          value={candidate.amountBasis ?? ''}
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
        <>
          <label>
            粗利率（%）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              max={100}
              aria-label={`${draft.label}の粗利率`}
              disabled={disabled}
              value={candidate.costRatePct === undefined ? '' : 100 - candidate.costRatePct}
              onChange={(e) => {
                const n = numberOrUndefined(e.target.value);
                set({ costRatePct: n === undefined || n > 100 ? undefined : 100 - n });
              }}
            />
          </label>
          <label>
            追加販売管理費等（{opBasisText}・百万円）
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              aria-label={`${draft.label}の追加販売管理費等`}
              disabled={disabled}
              value={candidate.sgaCostYen === undefined ? '' : candidate.sgaCostYen / 1_000_000}
              onChange={(e) => {
                const n = numberOrUndefined(e.target.value);
                set({ sgaCostYen: n === undefined ? undefined : Math.round(n * 1_000_000) });
              }}
            />
          </label>
          {candidate.sgaCostYen !== undefined && (
            <p className="plan-note">
              {candidate.amountBasis === 'MONTHLY'
                ? `追加販売管理費等は月額${amountText(candidate.sgaCostYen)}（年額${amountText(candidate.sgaCostYen * 12)}として営業利益を計算）`
                : candidate.amountBasis === 'TOTAL'
                  ? `追加販売管理費等は一回限り（${amountText(candidate.sgaCostYen)}）として営業利益を計算`
                  : `追加販売管理費等は年額${amountText(candidate.sgaCostYen)}として営業利益を計算`}
            </p>
          )}
          {ctx.hasCostEffect && candidate.sgaCostYen !== undefined && (
            <label>
              追加販売管理費等は、同じ案件の追加費用（別の効果）と同じ費用ですか
              <select
                aria-label={`${draft.label}の追加販売管理費等と追加費用`}
                value={candidate.sgaSameAsAddCost === undefined ? '' : candidate.sgaSameAsAddCost ? 'same' : 'different'}
                disabled={disabled}
                onChange={(e) => set({ sgaSameAsAddCost: e.target.value === '' ? undefined : e.target.value === 'same' })}
              >
                <option value="">未回答</option>
                <option value="same">同じ費用（追加費用の効果で差し引く。二重に差し引かない）</option>
                <option value="different">別の費用（追加販売管理費等として別に差し引く）</option>
              </select>
            </label>
          )}
          <p className="plan-note">
            {annual.annualGrossProfitYen === undefined
              ? '粗利益（参考）：未算定（粗利率を入れると算定します）'
              : `粗利益（参考・営業利益には含めない）：${amountText(annual.annualGrossProfitYen)}`}
            {' ／ '}
            {annual.annualOperatingEffectYen === undefined
              ? '営業利益増分：未算定（粗利率と追加販売管理費等を入れ、同じ案件の追加費用との関係を選ぶと算定します。0とはみなしません）'
              : `営業利益増分：${amountText(annual.annualOperatingEffectYen)}（粗利益 − 追加販売管理費等）`}
          </p>
        </>
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
            <option value="SERVICE">サービス提供（役務）</option>
          </select>
        </label>
      )}
      {isRevenue && annual.annualRevenueYen !== undefined && (
        <p className="plan-note">年額の売上：{amountText(annual.annualRevenueYen)}</p>
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
          <p className="plan-note">実際に削減できる費用を入力してください。費用配賦の見直しや作業時間の短縮だけでは計上しません。</p>
          <p className="plan-note">
            {addCostYen === undefined || candidate.directAmountYen === undefined
              ? '追加費用が未入力のため、年間利益改善額は算出しません（追加費用は別の効果として入力します）。'
              : `年間利益改善額＝年間削減額 ${amountText(candidate.directAmountYen)} − 追加費用 ${amountText(addCostYen)} ＝ ${amountText(candidate.directAmountYen - addCostYen)}`}
          </p>
        </>
      )}
      {ctx.overlaps.length > 0 && (
        <div className="plan-note" aria-label={`${draft.label}の重複候補`}>
          <p>重なる可能性のある他の施策（{ctx.overlaps.length}件）：</p>
          <ul>
            {ctx.overlaps.map((o, i) => (
              <li key={`${o.deptName}|${o.projectTitle}|${i}`}>
                {o.deptName} / {o.projectTitle}：{o.reason}（{o.holding ? '計上を保留中' : '注意'}）
              </li>
            ))}
          </ul>
        </div>
      )}
      {(ctx.overlaps.some((o) => o.holding) || (isCost && ctx.revenueHasOperatingEffect === true)) && (
        <label>
          {isCost && !ctx.overlaps.some((o) => o.holding)
            ? '同じ案件の売上増加で営業利益増分を計上しています。コスト削減との重複がないことの説明'
            : `同じ対象の可能性がある他の施策（${ctx.overlaps.filter((o) => o.holding).length}件）について、重複していない理由`}
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
    </div>
  );
}

export function Stage4FinanceConfirm({
  drafts,
  saved,
  planPeriod = null,
  writable,
  reasonNotWritable,
  answers,
  overlapOf = () => [],
  onAnswer,
}: {
  drafts: FinanceEffectDraft[];
  saved: FinanceEffect[];
  overlapOf?: FinanceOverlapOf;
  planPeriod?: PlanPeriod | null;
  writable: boolean;
  reasonNotWritable?: string;
  answers: FinanceAnswersByKind;
  onAnswer: (kind: FinanceEffectDraft['kind'], answers: FinanceAnswers) => void;
}) {
  const baseCtx = financeConfirmContext(drafts, saved, answers);
  const addCostYen = drafts.find((d) => d.kind === 'COST_INCREASE')?.base.directAmountYen;
  return (
    <section aria-labelledby="stage4-finance-confirm" className="plan-impact-estimate">
      <h3 id="stage4-finance-confirm" className="plan-h3">
        財務効果（STAGE6へ反映）
      </h3>
      <p className="plan-note">
        入力して「計画を保存」を押すと、財務効果もまとめて保存されます。計算に必要な項目がそろったものは、保存と同時にSTAGE6に反映されます。投資・追加費用は、この下の欄で入力します。
      </p>
      {planPeriod && (
        <p className="plan-note">
          計画期間：{planPeriod.startYm}〜{planPeriod.endYm}
        </p>
      )}
      {!writable && reasonNotWritable && <p className="plan-note">{reasonNotWritable}</p>}
      {drafts.map((draft) => {
        const savedOne = saved.find((e) => e.kind === draft.kind);
        return (
          <DraftCard
            key={`${draft.kind}|${JSON.stringify(draft.base)}`}
            draft={draft}
            saved={savedOne}
            answers={answers[draft.kind] ?? initialFinanceAnswers(draft, savedOne)}
            baseCtx={baseCtx}
            overlapOf={overlapOf}
            planPeriod={planPeriod}
            writable={writable}
            onChange={(a) => onAnswer(draft.kind, a)}
            addCostYen={addCostYen}
          />
        );
      })}
    </section>
  );
}
