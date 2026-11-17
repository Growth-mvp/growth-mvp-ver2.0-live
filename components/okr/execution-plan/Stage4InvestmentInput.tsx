import { checkInvestmentRow, investmentRowOf, newInvestmentRow, type InvestmentRowDraft, type OpexRelation } from '@/lib/stage4/planView/investmentRows';
import type { ExecutionHumanInvestment, SpendAmountBasis } from '@/types/strategy';
import { formatYenScaled } from '@/utils/yenScale';

const BASIS_OPTIONS: { value: SpendAmountBasis; label: string }[] = [
  { value: 'TOTAL', label: '総額（期間全体の金額）' },
  { value: 'MONTHLY', label: '月額' },
  { value: 'ANNUAL', label: '年額' },
];

const BASIS_SHORT_LABEL: Record<SpendAmountBasis, string> = { TOTAL: '総額', MONTHLY: '月額', ANNUAL: '年額' };

const CATEGORY_LABEL: Record<'CAPEX' | 'OPEX', string> = {
  CAPEX: '設備投資等（CAPEX）',
  OPEX: '人件費・外注費等（OPEX）',
};

const RELATION_LABEL: Record<OpexRelation, string> = {
  IN_PLAN: '営業利益に含まれている（既存の計画に計上済み）',
  NOT_IN_PLAN: '営業利益に含まれていない（STAGE6で営業利益から差し引く）',
  SAME_AS_ADD_COST: '同じ案件の確認済みの追加費用と同じ費用（二重に差し引かない）',
  DIFFERENT_FROM_ADD_COST: '同じ案件の確認済みの追加費用とは別の費用（営業利益から差し引く）',
};

function savedTimingText(record: ExecutionHumanInvestment): string {
  const spend = record.spend;
  if (!spend) return '';
  if (spend.recurrence === 'ONE_TIME') return `${spend.paymentYm ?? '未設定'}に一時支出`;
  const basis = spend.amountBasis ? BASIS_SHORT_LABEL[spend.amountBasis] : '金額基準未設定';
  return `${spend.startYm ?? '未設定'}〜${spend.endYm ?? '未設定'}・${basis}`;
}

function SavedRow({
  record,
  pendingRemoval,
  onEdit,
  onRemove,
  onCancelRemove,
  disabled,
  editDisabled,
}: {
  record: ExecutionHumanInvestment;
  pendingRemoval: boolean;
  onEdit: () => void;
  onRemove?: () => void;
  onCancelRemove: () => void;
  disabled: boolean;
  /** 同じ明細を入力中のときは編集を止める（削除は入力中の内容を捨てて行える） */
  editDisabled: boolean;
}) {
  const category = record.spend?.category === 'OPEX' ? 'OPEX' : 'CAPEX';
  const relation = category === 'OPEX' && record.spend?.opexRelation ? RELATION_LABEL[record.spend.opexRelation] : null;
  return (
    <li className="plan-note">
      <strong>{record.name}</strong>（{CATEGORY_LABEL[category]}）：{formatYenScaled(record.amount ?? 0)}・{savedTimingText(record)}
      {relation && <>・{relation}</>}{' '}
      {pendingRemoval ? (
        <>
          <span role="status">削除予定（「計画を保存」で削除します。登録済みの月次実績は残り、STAGE6では計画なしとして確認できます）</span>{' '}
          <button type="button" onClick={onCancelRemove} disabled={disabled}>
            取り消し
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={onEdit} disabled={disabled || editDisabled}>
            編集
          </button>
          {onRemove && (
            <>
              {' '}
              <button type="button" onClick={onRemove} disabled={disabled}>
                削除
              </button>
            </>
          )}
        </>
      )}
    </li>
  );
}

function DraftRow({
  row,
  disabled,
  addCostConfirmed,
  onChange,
  onRemove,
}: {
  row: InvestmentRowDraft;
  disabled: boolean;
  addCostConfirmed: boolean;
  onChange: (next: InvestmentRowDraft) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<InvestmentRowDraft>) => onChange({ ...row, ...patch });
  const check = checkInvestmentRow(row);
  const label = row.name.trim() || '投資・追加費用';
  return (
    <div className="plan-param" aria-label={`${label}の入力`}>
      <label>
        項目名・内容
        <input type="text" aria-label="投資・追加費用の項目名" value={row.name} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label>
        支出区分
        <select
          aria-label="投資・追加費用の支出区分"
          value={row.category}
          disabled={disabled}
          onChange={(e) => set({ category: e.target.value as InvestmentRowDraft['category'], opexRelation: '' })}
        >
          <option value="">選んでください</option>
          <option value="CAPEX">{CATEGORY_LABEL.CAPEX}</option>
          <option value="OPEX">{CATEGORY_LABEL.OPEX}</option>
        </select>
      </label>
      <label>
        金額（円）
        <input
          type="text"
          inputMode="numeric"
          aria-label="投資・追加費用の金額"
          value={row.amount}
          disabled={disabled}
          onChange={(e) => set({ amount: e.target.value.replace(/[,，\s]/g, '') })}
        />
      </label>
      <label>
        支出形態
        <select
          aria-label="投資・追加費用の支出形態"
          value={row.recurrence}
          disabled={disabled}
          onChange={(e) => set({ recurrence: e.target.value as InvestmentRowDraft['recurrence'] })}
        >
          <option value="">選んでください</option>
          <option value="ONE_TIME">一時支出</option>
          <option value="RECURRING">継続支出</option>
        </select>
      </label>
      {row.recurrence === 'ONE_TIME' && (
        <label>
          支出年月
          <input type="month" aria-label="投資・追加費用の支出年月" value={row.paymentYm} disabled={disabled} onChange={(e) => set({ paymentYm: e.target.value })} />
        </label>
      )}
      {row.recurrence === 'RECURRING' && (
        <>
          <label>
            開始年月
            <input type="month" aria-label="投資・追加費用の開始年月" value={row.startYm} disabled={disabled} onChange={(e) => set({ startYm: e.target.value })} />
          </label>
          <label>
            終了年月
            <input type="month" aria-label="投資・追加費用の終了年月" value={row.endYm} disabled={disabled} onChange={(e) => set({ endYm: e.target.value })} />
          </label>
          <label>
            金額基準
            <select
              aria-label="投資・追加費用の金額基準"
              value={row.amountBasis}
              disabled={disabled}
              onChange={(e) => set({ amountBasis: e.target.value as InvestmentRowDraft['amountBasis'] })}
            >
              <option value="">選んでください</option>
              {BASIS_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {row.category === 'OPEX' && (
        <label>
          営業利益との関係
          <select
            aria-label="投資・追加費用の営業利益との関係"
            value={row.opexRelation}
            disabled={disabled}
            onChange={(e) => set({ opexRelation: e.target.value as InvestmentRowDraft['opexRelation'] })}
          >
            <option value="">選んでください</option>
            <option value="IN_PLAN">{RELATION_LABEL.IN_PLAN}</option>
            <option value="NOT_IN_PLAN">{RELATION_LABEL.NOT_IN_PLAN}</option>
            {addCostConfirmed && <option value="SAME_AS_ADD_COST">{RELATION_LABEL.SAME_AS_ADD_COST}</option>}
            {addCostConfirmed && <option value="DIFFERENT_FROM_ADD_COST">{RELATION_LABEL.DIFFERENT_FROM_ADD_COST}</option>}
          </select>
        </label>
      )}
      {row.category === 'OPEX' && addCostConfirmed && (
        <p className="plan-note">この案件には確認済みの追加費用があります。同じ費用かどうかを選ぶまで、二重には差し引きません。</p>
      )}
      {!check.ok && <p className="plan-note">未入力のため保存されません：{check.reasons.join('、')}</p>}
      {check.ok && <p className="plan-note">入力がそろいました。「計画を保存」で保存されます。</p>}
      <button type="button" onClick={onRemove} disabled={disabled}>
        この行を削除
      </button>
    </div>
  );
}

export function Stage4InvestmentInput({
  saved,
  rows,
  writable,
  reasonNotWritable,
  addCostConfirmed = false,
  pendingRemovals = [],
  onChangeRemovals,
  onChange,
  newRecordId,
}: {
  saved: ExecutionHumanInvestment[];
  rows: InvestmentRowDraft[];
  writable: boolean;
  reasonNotWritable?: string;
  /** 同じ案件に確認済みの追加費用（COST_INCREASE）があるか。OPEXとの同一費用の確認に使う */
  addCostConfirmed?: boolean;
  /** 削除予定の投資明細のID。「計画を保存」で削除する */
  pendingRemovals?: string[];
  onChangeRemovals?: (ids: string[]) => void;
  onChange: (rows: InvestmentRowDraft[]) => void;
  newRecordId: () => string;
}) {
  const disabled = !writable;
  const editingIds = new Set(rows.map((r) => r.recordId));
  const pendingIds = new Set(pendingRemovals);
  return (
    <section aria-labelledby="stage4-investment-input" className="plan-impact-estimate">
      <h3 id="stage4-investment-input" className="plan-h3">
        投資・追加費用（STAGE6へ反映）
      </h3>
      <p className="plan-note">
        設備投資（CAPEX）は支出年度の投資CFに一度だけ反映します。人件費・外注費等（OPEX）は、「営業利益に含まれていない」を選んだものだけ営業利益から差し引きます。
      </p>
      {!writable && reasonNotWritable && <p className="plan-note">{reasonNotWritable}</p>}
      {saved.length > 0 && (
        <ul aria-label="保存済みの投資・追加費用">
          {saved.map((record) => {
            const id = String(record.id);
            const pending = pendingIds.has(id);
            return (
              <SavedRow
                key={id}
                record={record}
                pendingRemoval={pending}
                disabled={disabled}
                editDisabled={editingIds.has(id) && !pending}
                onEdit={() => onChange([...rows, investmentRowOf(record)])}
                onRemove={
                  onChangeRemovals
                    ? () => {
                        onChangeRemovals([...pendingRemovals, id]);
                        onChange(rows.filter((r) => r.recordId !== id));
                      }
                    : undefined
                }
                onCancelRemove={() => onChangeRemovals?.(pendingRemovals.filter((x) => x !== id))}
              />
            );
          })}
        </ul>
      )}
      {rows.map((row) => (
        <DraftRow
          key={row.key}
          row={row}
          disabled={disabled}
          addCostConfirmed={addCostConfirmed}
          onChange={(next) => onChange(rows.map((r) => (r.key === row.key ? next : r)))}
          onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}
        />
      ))}
      <button type="button" disabled={disabled} onClick={() => onChange([...rows, newInvestmentRow(newRecordId())])}>
        + 投資・追加費用を追加
      </button>
    </section>
  );
}
