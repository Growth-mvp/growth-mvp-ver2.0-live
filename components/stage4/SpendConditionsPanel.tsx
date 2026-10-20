'use client';

import type {
  SpendAmountBasis,
  SpendCategoryCode,
  SpendRecurrence,
  SpendSchedule,
} from '@/types/strategy';
import { SPEND_CATEGORY_LABEL, type InvestmentItem } from '@/utils/stage6/investmentDemand';

const SOURCE_LABEL: Record<InvestmentItem['source'], string> = {
  SKILL_PLAN: 'スキルプラン（円）',
  HUMAN_INVESTMENT: '人的投資（円）',
  IMPACT_INVESTMENT: '必要投資額（百万円）',
  IMPACT_ASSUMPTION: '期待成果の前提（百万円から導出）',
  INVEST_KR: '投資KR',
};

function fmtYen(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ja-JP')} 円`;
}

function amountText(item: InvestmentItem): string {
  if (item.amountStatus === 'MISSING') return '金額が未入力';
  if (item.amountStatus === 'INVALID') return '負の値のため集計されません';
  if (item.amountStatus === 'UNIT_PENDING') return '単位が確認できないため集計されません';
  return fmtYen(item.amountYen);
}

function isComplete(item: InvestmentItem): boolean {
  return (
    item.category !== 'UNCLASSIFIED' &&
    item.recurrence !== 'UNSET' &&
    item.amountBasis !== null &&
    item.scheduleStatus === 'VALID'
  );
}

function sourceHint(item: InvestmentItem): string | null {
  if (item.source === 'HUMAN_INVESTMENT' && item.referenceYm) {
    return `実行時期 ${item.referenceYm} は自動で支出月にしません。使う場合は支出月を入力してください。`;
  }
  if (item.source === 'IMPACT_ASSUMPTION') {
    return '人数×月数×月額＋外部費用から導出した総額です。金額の基準は総額に固定されます。';
  }
  if (item.source === 'INVEST_KR' && item.amountStatus === 'UNIT_PENDING') {
    return '単位が円の投資KRのみ集計対象です。';
  }
  return null;
}

type Props = {
  items: InvestmentItem[];
  disabled: boolean;
  onPatch: (item: InvestmentItem, patch: Partial<SpendSchedule>) => void;
};

export function SpendConditionsPanel({ items, disabled, onPatch }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 text-[12px] text-zinc-600">
        投資・費用の登録がありません。スキル・人的投資・必要投資額・期待成果の前提を入力すると、ここに表示されます。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-600">
        支出区分・支出時期・金額の基準を入力すると、STAGE6の資金需要に反映されます。未入力の項目は資金需要に含まれません。
      </p>
      {items.map((item) => (
        <SpendConditionRow key={`${item.ref.deptIndex}:${item.ref.projectIndex}:${item.itemId}`} item={item} disabled={disabled} onPatch={onPatch} />
      ))}
    </div>
  );
}

function SpendConditionRow({ item, disabled, onPatch }: { item: InvestmentItem } & Pick<Props, 'disabled' | 'onPatch'>) {
  const hint = sourceHint(item);
  const basisLocked = item.source === 'IMPACT_ASSUMPTION';
  const oneTime = item.recurrence === 'ONE_TIME';

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-zinc-900">{item.label}</div>
          <div className="text-[11px] text-zinc-500">
            {SOURCE_LABEL[item.source]} ／ {amountText(item)}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isComplete(item) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {isComplete(item) ? '支出条件 設定済み' : '支出条件 未設定あり'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="text-[11px] font-semibold text-zinc-700">
          支出区分
          <select
            className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-normal disabled:bg-zinc-100"
            value={item.category}
            disabled={disabled}
            onChange={(e) =>
              onPatch(item, {
                category: e.target.value === 'UNCLASSIFIED' ? undefined : (e.target.value as SpendCategoryCode),
              })
            }
          >
            <option value="UNCLASSIFIED">未分類</option>
            <option value="CAPEX">{SPEND_CATEGORY_LABEL.CAPEX}</option>
            <option value="OPEX">{SPEND_CATEGORY_LABEL.OPEX}</option>
            <option value="OTHER">{SPEND_CATEGORY_LABEL.OTHER}</option>
          </select>
        </label>

        <label className="text-[11px] font-semibold text-zinc-700">
          継続性
          <select
            className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-normal disabled:bg-zinc-100"
            value={item.recurrence === 'UNSET' ? '' : item.recurrence}
            disabled={disabled}
            onChange={(e) => {
              const recurrence = e.target.value === '' ? undefined : (e.target.value as SpendRecurrence);
              onPatch(item, {
                recurrence,
                ...(recurrence === 'ONE_TIME' ? { amountBasis: 'TOTAL' as const } : {}),
              });
            }}
          >
            <option value="">未設定</option>
            <option value="ONE_TIME">一時的な支出</option>
            <option value="RECURRING">継続的な支出</option>
          </select>
        </label>

        <label className="text-[11px] font-semibold text-zinc-700">
          金額の基準
          <select
            className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-normal disabled:bg-zinc-100"
            value={item.amountBasis ?? ''}
            disabled={disabled || basisLocked || oneTime}
            onChange={(e) =>
              onPatch(item, {
                amountBasis: e.target.value === '' ? undefined : (e.target.value as SpendAmountBasis),
              })
            }
          >
            <option value="">未確認</option>
            <option value="TOTAL">総額</option>
            {!oneTime && <option value="MONTHLY">月額</option>}
            {!oneTime && <option value="ANNUAL">年額</option>}
          </select>
          {basisLocked && <span className="mt-1 block text-[10px] font-normal text-zinc-500">総額に固定</span>}
          {oneTime && !basisLocked && <span className="mt-1 block text-[10px] font-normal text-zinc-500">一時的な支出は総額</span>}
        </label>

        <div className="text-[11px] font-semibold text-zinc-700">
          {item.recurrence === 'RECURRING' ? (
            <div className="grid grid-cols-2 gap-2">
              <label>
                開始月
                <input
                  type="month"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-normal disabled:bg-zinc-100"
                  value={item.startYm ?? ''}
                  disabled={disabled}
                  onChange={(e) => onPatch(item, { startYm: e.target.value || undefined })}
                />
              </label>
              <label>
                終了月
                <input
                  type="month"
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-normal disabled:bg-zinc-100"
                  value={item.endYm ?? ''}
                  disabled={disabled}
                  onChange={(e) => onPatch(item, { endYm: e.target.value || undefined })}
                />
              </label>
            </div>
          ) : (
            <label>
              支出月
              <input
                type="month"
                className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-normal disabled:bg-zinc-100"
                value={item.paymentYm ?? ''}
                disabled={disabled || item.recurrence !== 'ONE_TIME'}
                onChange={(e) => onPatch(item, { paymentYm: e.target.value || undefined })}
              />
            </label>
          )}
        </div>
      </div>

      {item.scheduleNote && <div className="mt-2 text-[11px] text-amber-700">{item.scheduleNote}</div>}
      {hint && <div className="mt-2 text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}
