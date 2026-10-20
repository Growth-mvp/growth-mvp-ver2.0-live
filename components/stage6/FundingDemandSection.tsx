'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Department, SpendDuplicateDecision } from '@/types/strategy';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import {
  applyDuplicateDecision,
  buildInvestmentDemandSummary,
  SPEND_CATEGORY_LABEL,
  type DuplicateStatus,
  type InvestmentItem,
} from '@/utils/stage6/investmentDemand';
import { attentionSummary } from './financePlanStatus';

const EMPTY_DEPARTMENTS: Department[] = [];

const SOURCE_LABEL: Record<InvestmentItem['source'], string> = {
  SKILL_PLAN: 'スキルプラン',
  HUMAN_INVESTMENT: '人的投資',
  IMPACT_INVESTMENT: '必要投資額',
  IMPACT_ASSUMPTION: '期待成果の前提',
  INVEST_KR: 'INVEST KR',
};

const PLAN_STATUS_LABEL: Record<string, string> = {
  approved: '承認済み',
  review: 'レビュー中',
  draft: '草案',
};

const DUPLICATE_LABEL: Record<DuplicateStatus, string> = {
  NONE: '確認不要',
  CANDIDATE: '重複確認（未確定）',
  DERIVED: '派生値（除外）',
  SAME_KEEP: '同一支出：集計対象',
  SAME_DUPLICATE: '同一支出：除外',
  DIFFERENT: '別支出として確認済み',
};

const DUPLICATE_CLASS: Record<DuplicateStatus, string> = {
  NONE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANDIDATE: 'bg-amber-50 text-amber-800 ring-amber-200',
  DERIVED: 'bg-slate-100 text-slate-600 ring-slate-200',
  SAME_KEEP: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SAME_DUPLICATE: 'bg-slate-100 text-slate-600 ring-slate-200',
  DIFFERENT: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const BASIS_LABEL: Record<string, string> = {
  TOTAL: '総額',
  MONTHLY: '月額',
  ANNUAL: '年額',
};

function fmtYen(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ja-JP')} 円`;
}

function itemAmountText(item: InvestmentItem): string {
  if (item.amountStatus === 'MISSING') return '未入力';
  if (item.amountStatus === 'INVALID') return '負の値のため除外';
  if (item.amountStatus === 'UNIT_PENDING') return '単位確認待ち';
  if (item.totalYen !== null) return fmtYen(item.totalYen);
  const basis = item.amountBasis ? BASIS_LABEL[item.amountBasis] : '基準未確認';
  return `入力額 ${fmtYen(item.amountYen)}（${basis}・換算不可）`;
}

function itemScheduleText(item: InvestmentItem): string {
  if (item.recurrence === 'ONE_TIME') return item.paymentYm ? `支出月 ${item.paymentYm}` : '時期未設定';
  if (item.recurrence === 'RECURRING') {
    return item.startYm && item.endYm ? `${item.startYm}〜${item.endYm}` : '期間未設定';
  }
  return '時期未設定';
}

function itemSpendConditionText(item: InvestmentItem): string {
  const category = SPEND_CATEGORY_LABEL[item.category];
  const recurrence =
    item.recurrence === 'ONE_TIME' ? '一時' : item.recurrence === 'RECURRING' ? '継続' : '継続性未設定';
  const basis = item.amountBasis ? BASIS_LABEL[item.amountBasis] : '基準未設定';
  return `${category} ／ ${recurrence} ／ ${basis}`;
}

function stage4Href(item: InvestmentItem): string {
  return `/okr?dept=${encodeURIComponent(item.deptName)}&project=${encodeURIComponent(item.projectTitle)}`;
}

export function FundingDemandSection() {
  const departments = useStrategyStore((s: StrategyState) =>
    Array.isArray(s.departments) ? s.departments : EMPTY_DEPARTMENTS,
  );
  const fiscalYearEnd = useStrategyStore((s: StrategyState) => s.fiscalYearEnd);
  const updateDepartments = useStrategyStore((s: StrategyState) => s.updateDepartments);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const summary = useMemo(
    () => buildInvestmentDemandSummary(departments, fiscalYearEnd),
    [departments, fiscalYearEnd],
  );
  const attention = useMemo(() => attentionSummary(summary.items), [summary.items]);

  const monthNote =
    summary.fiscalYearEndMonth === null
      ? '決算月が未設定のため暦年（12月期）として集計しています。'
      : `決算月: ${summary.fiscalYearEndMonth}月期`;

  const decideDuplicate = (
    item: InvestmentItem,
    decision: SpendDuplicateDecision | null,
    sameAsItemId?: string,
  ) =>
    updateDepartments((prev: Department[]) =>
      applyDuplicateDecision(prev, item.ref.deptIndex, item.ref.projectIndex, item.itemId, decision, sameAsItemId),
    );

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">投資・資金需要</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          投資・費用の内容と支出条件はSTAGE4で入力します。ここでは資金需要への集計結果と重複確認を表示します。
          資金計画に反映されるのは「確認済み」の金額のみです。
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {monthNote}。入力確認（分類・時期・重複）と計画の承認は別の状態です。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
          <div className="text-sm font-semibold text-slate-700">資金計画に反映する確認済み投資・費用額</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{fmtYen(summary.readyYen)}</div>
          <div className="mt-1 text-xs text-slate-600">
            {summary.readyCount}件（承認済み {fmtYen(summary.approvedReadyYen)} ／ 未承認 {fmtYen(summary.unapprovedReadyYen)}）
          </div>
        </div>

        <div
          className={`rounded-xl border p-5 ${
            attention.count > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="text-sm font-semibold text-slate-700">未確定・確認が必要な金額</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{fmtYen(attention.yen)}</div>
          <div className="mt-1 text-xs text-slate-600">
            {attention.count > 0
              ? `${attention.count}件の項目が未確定${
                  attention.unconvertedCount > 0 ? `（うち${attention.unconvertedCount}件は金額を換算できず、金額に含めていません）` : ''
                }`
              : '確認が必要な項目はありません'}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-xs font-semibold text-slate-600">補足（区分が重なる場合があるため、合計はしていません）</div>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-700 sm:grid-cols-2 md:grid-cols-4">
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">分類未確定</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {fmtYen(summary.unclassifiedYen)}（{summary.unclassifiedCount}件）
            </dd>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">支出時期未設定</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {fmtYen(summary.unscheduledYen)}
              {summary.periodicUnresolvedCount > 0 && `・期間未確定 ${summary.periodicUnresolvedCount}件`}
            </dd>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">金額基準未確認</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {fmtYen(summary.basisPendingYen)}（{summary.basisPendingCount}件）
            </dd>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">重複確認中（集計から除外）</dt>
            <dd className="mt-0.5 font-medium text-slate-900">
              {fmtYen(summary.candidateYen)}（{summary.candidateCount}件）
            </dd>
          </div>
        </dl>
        {(summary.unitPendingCount > 0 || summary.missingCount > 0) && (
          <div className="mt-2 text-xs text-slate-600">
            {summary.unitPendingCount > 0 && <span className="mr-3">単位確認待ち {summary.unitPendingCount}件</span>}
            {summary.missingCount > 0 && <span>金額未入力 {summary.missingCount}件</span>}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-900">年度別の確認済み支出額</h3>
        {summary.yearly.length === 0 ? (
          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            確認済みの支出はまだありません。STAGE4で支出区分・支出時期・金額の基準を入力してください。
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">年度</th>
                  <th className="px-3 py-2 text-right font-semibold">確認済み支出額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.yearly.map((y) => (
                  <tr key={y.fiscalYear}>
                    <td className="px-3 py-2 text-slate-800">{y.label}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">{fmtYen(y.amountYen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-900">投資・費用の明細</h3>
        {summary.items.length === 0 ? (
          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            STAGE4の実行計画に投資・費用の登録がありません。
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">プロジェクト・計画状態</th>
                  <th className="px-3 py-2 text-left font-semibold">投資・費用の内容</th>
                  <th className="px-3 py-2 text-right font-semibold">金額</th>
                  <th className="px-3 py-2 text-left font-semibold">支出条件（STAGE4）</th>
                  <th className="px-3 py-2 text-left font-semibold">支出時期・期間</th>
                  <th className="px-3 py-2 text-left font-semibold">重複確認</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.items.map((item) => {
                  const rowKey = `${item.ref.deptIndex}:${item.ref.projectIndex}:${item.itemId}`;
                  const siblings = summary.items.filter(
                    (other) =>
                      other.ref.deptIndex === item.ref.deptIndex &&
                      other.ref.projectIndex === item.ref.projectIndex &&
                      other.itemId !== item.itemId &&
                      other.amountStatus === 'OK' &&
                      other.duplicateStatus !== 'DERIVED',
                  );
                  return (
                    <ItemRow
                      key={rowKey}
                      item={item}
                      open={openKey === rowKey}
                      onToggle={() => setOpenKey(openKey === rowKey ? null : rowKey)}
                      siblings={siblings}
                      onDuplicate={(decision, sameAs) => decideDuplicate(item, decision, sameAs)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type ItemRowProps = {
  item: InvestmentItem;
  open: boolean;
  onToggle: () => void;
  siblings: InvestmentItem[];
  onDuplicate: (decision: SpendDuplicateDecision | null, sameAsItemId?: string) => void;
};

function ItemRow({ item, open, onToggle, siblings, onDuplicate }: ItemRowProps) {
  const planLabel = item.planStatus ? PLAN_STATUS_LABEL[item.planStatus] ?? item.planStatus : '未設定';
  const reviewDecision = item.spend?.duplicateReview?.decision ?? '';
  const isDerived = item.duplicateStatus === 'DERIVED';
  const locked = item.planStatus === 'approved';
  const showDuplicateControl =
    item.duplicateStatus === 'CANDIDATE' ||
    item.duplicateStatus === 'SAME_KEEP' ||
    item.duplicateStatus === 'SAME_DUPLICATE' ||
    item.duplicateStatus === 'DIFFERENT' ||
    siblings.length > 0;

  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-2">
          <div className="font-medium text-slate-900">{item.projectTitle}</div>
          <div className="text-xs text-slate-500">
            {item.deptName} ／ 計画状態: {planLabel}
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="text-slate-800">{item.label}</div>
          <div className="text-xs text-slate-500">{SOURCE_LABEL[item.source]}</div>
        </td>
        <td className="px-3 py-2 text-right">
          <span className={item.totalYen !== null ? 'font-medium text-slate-900' : 'text-xs text-amber-700'}>
            {itemAmountText(item)}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-700">
          <div>{itemSpendConditionText(item)}</div>
          <Link href={stage4Href(item)} className="mt-1 inline-block font-semibold text-indigo-700 hover:underline">
            STAGE4で編集
          </Link>
        </td>
        <td className="px-3 py-2 text-slate-700">
          <div>{itemScheduleText(item)}</div>
          {item.scheduleNote && <div className="text-xs text-amber-700">{item.scheduleNote}</div>}
        </td>
        <td className="px-3 py-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${DUPLICATE_CLASS[item.duplicateStatus]}`}
          >
            {DUPLICATE_LABEL[item.duplicateStatus]}
          </span>
          {item.duplicateNote && <div className="mt-1 text-xs text-slate-500">{item.duplicateNote}</div>}
          {!isDerived && showDuplicateControl && (
            <button
              type="button"
              onClick={onToggle}
              className="mt-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {open ? '閉じる' : '重複を判断'}
            </button>
          )}
        </td>
      </tr>
      {open && !isDerived && showDuplicateControl && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="px-3 py-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">重複確認</div>
              {locked ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800">
                  承認済みのプロジェクトのため、重複判断は読み取り専用です。承認状態はSTAGE4で確認してください。
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">
                  金額が一致するだけでは同一とみなしません。同一の支出かどうかを選んでください。
                  金額・支出時期・プロジェクトIDを変更すると、判断は無効になり再確認が必要になります（プロジェクト名の変更は影響しません）。
                </p>
              )}
              <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end">
                <label className="text-xs font-semibold text-slate-700">
                  判断
                  <select
                    disabled={locked}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal disabled:bg-slate-100 md:w-80"
                    value={
                      reviewDecision === 'SAME_DUPLICATE'
                        ? `SAME_DUPLICATE:${item.spend?.duplicateReview?.sameAsItemId ?? ''}`
                        : reviewDecision
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') onDuplicate(null);
                      else if (v === 'DIFFERENT') onDuplicate('DIFFERENT');
                      else if (v === 'SAME_KEEP') onDuplicate('SAME_KEEP');
                      else if (v.startsWith('SAME_DUPLICATE:')) {
                        const sameAs = v.slice('SAME_DUPLICATE:'.length);
                        if (sameAs) onDuplicate('SAME_DUPLICATE', sameAs);
                      }
                    }}
                  >
                    <option value="">未確認（集計から除外）</option>
                    <option value="DIFFERENT">別支出（両方を集計）</option>
                    <option value="SAME_KEEP">同一支出：この明細を集計対象にする</option>
                    {siblings.map((other) => (
                      <option key={other.itemId} value={`SAME_DUPLICATE:${other.itemId}`}>
                        同一支出：集計対象は「{other.label}」（{other.projectTitle}）
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-[11px] text-slate-500">
                  「集計対象は…」を選ぶと、選んだ明細が集計対象になり、この明細は除外されます。
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
