'use client';

import { useState } from 'react';

type CounterpartyType =
  | 'executive'
  | 'manager'
  | 'own_department'
  | 'other_department'
  | 'backoffice'
  | 'field_member'
  | 'customer'
  | 'unknown'
  | 'other';

type IntakeDraft = {
  situation_text?: string;
  my_recognition_text?: string;
  ideal_text?: string;
  expectation_text?: string;
  counterparty_type?: CounterpartyType;
  counterparty_detail?: string;
};

const counterpartyOptions = [
  { value: 'executive' as const, label: '経営' },
  { value: 'manager' as const, label: '上司・管理職' },
  { value: 'own_department' as const, label: '自部門' },
  { value: 'other_department' as const, label: '他部門・関連部門' },
  { value: 'backoffice' as const, label: '管理部門' },
  { value: 'field_member' as const, label: '現場メンバー' },
  { value: 'customer' as const, label: '顧客' },
  { value: 'unknown' as const, label: '特定できない' },
  { value: 'other' as const, label: 'その他' },
];

type OrgAlignmentIntakeReviewCardProps = {
  draft: IntakeDraft;
  onUpdate: (updatedDraft: IntakeDraft) => void;
  onProceed: (finalDraft: IntakeDraft) => void;
  isProcessing?: boolean;
};

export default function OrgAlignmentIntakeReviewCard({
  draft,
  onUpdate,
  onProceed,
  isProcessing = false,
}: OrgAlignmentIntakeReviewCardProps) {
  const [editingDraft, setEditingDraft] = useState<IntakeDraft>(draft);

  const handleFieldChange = (field: keyof IntakeDraft, value: string) => {
    const updatedDraft = {
      ...editingDraft,
      [field]: value,
    };
    setEditingDraft(updatedDraft);
    onUpdate(updatedDraft);
  };

  const handleProceed = () => {
    onProceed(editingDraft);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 text-lg font-bold text-slate-950">
          AIが整理した内容を確認してください
        </h3>
        <p className="text-sm leading-7 text-slate-600">
          以下の項目に不足や誤りがあれば、編集してください。
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* 1. どんな場面でもやもやしましたか？ */}
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-900">
              1. どんな場面でもやもやしましたか？
            </span>
            <textarea
              value={editingDraft.situation_text || ''}
              onChange={(e) => handleFieldChange('situation_text', e.target.value)}
              disabled={isProcessing}
              className="min-h-[120px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
            />
          </label>

          {/* 2. その時、自分はどう受け止めましたか？ */}
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-900">
              2. その時、自分はどう受け止めましたか？
            </span>
            <textarea
              value={editingDraft.my_recognition_text || ''}
              onChange={(e) => handleFieldChange('my_recognition_text', e.target.value)}
              disabled={isProcessing}
              className="min-h-[120px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
            />
          </label>

          {/* 3. 本来どうあるべきだと思いますか？ */}
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-900">
              3. 本来どうあるべきだと思いますか？
            </span>
            <textarea
              value={editingDraft.ideal_text || ''}
              onChange={(e) => handleFieldChange('ideal_text', e.target.value)}
              disabled={isProcessing}
              className="min-h-[120px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
            />
          </label>

          {/* 4. 相手に何を期待していましたか？ */}
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-900">
              4. 相手に何を期待していましたか？
            </span>
            <textarea
              value={editingDraft.expectation_text || ''}
              onChange={(e) => handleFieldChange('expectation_text', e.target.value)}
              disabled={isProcessing}
              className="min-h-[120px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
            />
          </label>
        </div>

        {/* 相手属性の選択 */}
        <div className="mt-6 space-y-3">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-900">
              5. 関係している相手・部門
            </span>
            <select
              value={editingDraft.counterparty_type || 'unknown'}
              onChange={(e) => handleFieldChange('counterparty_type', e.target.value as CounterpartyType)}
              disabled={isProcessing}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
            >
              {counterpartyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {editingDraft.counterparty_type === 'other' && (
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-900">相手方の詳細</span>
              <input
                type="text"
                value={editingDraft.counterparty_detail || ''}
                onChange={(e) => handleFieldChange('counterparty_detail', e.target.value)}
                disabled={isProcessing}
                placeholder="例：外部パートナー、その他"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
              />
            </label>
          )}
        </div>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">
          入力された内容は、個人や部門を責めるためではなく、認識のズレを整理し、
          擦り合わせるために使います。AIの提示内容は断定ではなく、対話の入口となる仮説です。
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleProceed}
            disabled={isProcessing}
            className={`rounded-xl px-6 py-3 font-semibold transition-colors ${
              isProcessing
                ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                : 'bg-slate-950 text-white hover:bg-slate-900'
            }`}
          >
            {isProcessing ? '整理・保存しています...' : 'AIで認識のズレを整理する'}
          </button>
        </div>
      </div>
    </div>
  );
}
