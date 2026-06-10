'use client';

import { useState } from 'react';
import { type CounterpartyType, type VisibilityMode } from '@/types/org-alignment';

type FormSubmitData = {
  situationText: string;
  myRecognitionText: string;
  idealText: string;
  expectationText: string;
  counterpartyType: CounterpartyType;
  counterpartyDetail: string;
  visibilityMode: VisibilityMode;
};

type OrgAlignmentFixedIntakeFormProps = {
  onSubmit: (data: FormSubmitData) => Promise<void>;
};

/**
 * Q2の内容から counterpartyType を簡易判定する
 */
function inferCounterpartyType(q2Text: string): CounterpartyType {
  const text = (q2Text || '').toLowerCase();

  if (text.includes('経営') || text.includes('経営層') || text.includes('CEO') || text.includes('執行役')) {
    return 'executive';
  }
  if (text.includes('上司') || text.includes('管理職') || text.includes('マネージャー')) {
    return 'manager';
  }
  if (text.includes('顧客') || text.includes('お客様') || text.includes('クライアント')) {
    return 'customer';
  }
  if (text.includes('自部門') || text.includes('自部署') || text.includes('同じ部門')) {
    return 'own_department';
  }
  if (text.includes('他部門') || text.includes('他部署') || text.includes('別部門') || text.includes('関連部門')) {
    return 'other_department';
  }
  if (text.includes('管理部門') || text.includes('バックオフィス') || text.includes('HR') || text.includes('人事')) {
    return 'backoffice';
  }
  if (text.includes('現場') || text.includes('メンバー') || text.includes('チーム') || text.includes('スタッフ')) {
    return 'field_member';
  }

  return 'unknown';
}

const visibilityOptions = [
  {
    value: "anonymous" as const,
    label: "匿名で共有",
    description: "入力者名を出さずに、認識のズレとして共有します。",
  },
  {
    value: "manager_only" as const,
    label: "管理者にのみ共有",
    description: "すり合わせの場を設定する管理者にだけ入力者を共有します。",
  },
  {
    value: "named" as const,
    label: "名前を出して共有",
    description: "関係者に入力者名を共有したうえで、すり合わせを依頼します。",
  },
];

export default function OrgAlignmentFixedIntakeForm({ onSubmit }: OrgAlignmentFixedIntakeFormProps) {
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');
  const [q3, setQ3] = useState('');
  const [q4, setQ4] = useState('');
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>('manager_only');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = q1.trim() && q2.trim() && q3.trim() && q4.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const data: FormSubmitData = {
        myRecognitionText: q1.trim(),
        counterpartyDetail: q2.trim(),
        situationText: q3.trim(),
        idealText: q4.trim(),
        expectationText: q4.trim(), // Q4を両方にマッピング
        counterpartyType: inferCounterpartyType(q2),
        visibilityMode,
      };

      await onSubmit(data);
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* STEP1 見出しと説明文 */}
      <div className="space-y-3 border-b border-slate-100 pb-6">
        <h3 className="text-lg font-bold text-slate-950">STEP1：違和感を4つの視点で整理する</h3>
        <p className="text-sm leading-6 text-slate-600">
          人や部署を責めるためではなく、方針・優先順位・役割責任・評価・意思決定などの「認識のズレ」として整理します。分かる範囲で入力してください。
        </p>
      </div>

      {/* Q1 */}
      <div className="space-y-2">
        <label htmlFor="q1" className="block text-sm font-semibold text-slate-950">
          Q1. まず、今感じている違和感やもやもやを、そのまま書いてください。
        </label>
        <p className="text-xs text-slate-500">うまく整理できていなくても大丈夫です。</p>
        <textarea
          id="q1"
          value={q1}
          onChange={(e) => setQ1(e.target.value)}
          placeholder="例）上司は営業成績を追いかけているように見えるのに、顧客満足度は見ていないように感じる。"
          disabled={isSubmitting}
          className="min-h-[120px] w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
        />
      </div>

      {/* Q2 */}
      <div className="space-y-2">
        <label htmlFor="q2" className="block text-sm font-semibold text-slate-950">
          Q2. その違和感は、主に誰・どの部門・どの仕組みや方針に対するものですか？
        </label>
        <p className="text-xs text-slate-500">対象を具体的に教えてください。</p>
        <textarea
          id="q2"
          value={q2}
          onChange={(e) => setQ2(e.target.value)}
          placeholder="例）営業部門の上司の行動。営業成績を重視する人事評価制度。"
          disabled={isSubmitting}
          className="min-h-[120px] w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
        />
      </div>

      {/* Q3 */}
      <div className="space-y-2">
        <label htmlFor="q3" className="block text-sm font-semibold text-slate-950">
          Q3. その違和感を持ったのは、どんな場面・出来事・会議・指示・やり取りがきっかけでしたか？
        </label>
        <p className="text-xs text-slate-500">具体的な場面を思い出してください。</p>
        <textarea
          id="q3"
          value={q3}
          onChange={(e) => setQ3(e.target.value)}
          placeholder="例）先月のマネジメント面談で、上司は『顧客満足度を上げたいはずだが、まずは売上数字を達成することが優先』と言った。"
          disabled={isSubmitting}
          className="min-h-[120px] w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
        />
      </div>

      {/* Q4 */}
      <div className="space-y-2">
        <label htmlFor="q4" className="block text-sm font-semibold text-slate-950">
          Q4. どのような対応・判断・仕組みであれば、その違和感は小さくなっていたと思いますか？
        </label>
        <p className="text-xs text-slate-500">あるべき状態や、期待していたことを教えてください。</p>
        <textarea
          id="q4"
          value={q4}
          onChange={(e) => setQ4(e.target.value)}
          placeholder="例）評価制度や上司の優先順位が、売上数字と顧客満足度の両方を同等に扱っていれば。または、短期と長期のどちらを優先するのか、明確に説明してもらえれば。"
          disabled={isSubmitting}
          className="min-h-[120px] w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
        />
      </div>

      {/* サポートテキスト */}
      <div className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
        <p className="font-semibold text-slate-700">💡 ポイント</p>
        <ul className="mt-2 space-y-1">
          <li>• 事実をそのまま書いてください。その後、AIがそれを認識のズレとして整理します。</li>
          <li>• 「上司が〜するべき」ではなく、「こういう場面で、こういう指示があった」という事実がヒントになります。</li>
          <li>• 完璧に整理する必要はありません。モヤモヤしたままでもOKです。</li>
        </ul>
      </div>

      {/* 共有範囲の選択 */}
      <div className="space-y-3 border-t border-slate-100 pt-6">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            すり合わせの場を依頼する際の共有範囲
          </p>
          <p className="mt-1 text-xs leading-6 text-slate-500">
            STEP5で「すり合わせの場を依頼」を選択した場合、どの範囲に共有するかを選択できます。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {visibilityOptions.map((option) => {
            const isSelected = visibilityMode === option.value;

            return (
              <label
                key={option.value}
                className={`relative block cursor-pointer rounded-2xl border bg-white p-4 pl-11 transition-colors ${
                  isSelected
                    ? 'border-slate-900 ring-1 ring-slate-900'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="visibilityMode"
                  value={option.value}
                  checked={isSelected}
                  onChange={() => setVisibilityMode(option.value)}
                  disabled={isSubmitting}
                  className="absolute left-4 top-5 h-4 w-4 accent-slate-950"
                />

                <span className="block w-full text-sm font-semibold leading-6 text-slate-950">
                  {option.label}
                </span>

                <span className="mt-1 block w-full text-xs leading-6 text-slate-500">
                  {option.description}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* サブミットボタン */}
      <button
        type="submit"
        disabled={!canSubmit || isSubmitting}
        className={`w-full rounded-xl px-6 py-3 font-semibold transition-colors ${
          !canSubmit || isSubmitting
            ? 'cursor-not-allowed bg-slate-200 text-slate-400'
            : 'bg-slate-950 text-white hover:bg-slate-900'
        }`}
      >
        {isSubmitting ? '認識のズレを整理中...' : 'この内容で認識のズレを整理する'}
      </button>
    </form>
  );
}
