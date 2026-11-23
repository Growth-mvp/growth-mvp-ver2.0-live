'use client';

import { useState } from 'react';
import type { Basis } from '@/lib/stage4/planView/adapter';

export type EditType = 'multiline' | 'text' | 'month' | 'number' | 'owner';

type Props = {
  label: string;
  value: string | number | null;
  original?: string | number | null;
  edited: boolean;
  type: EditType;
  basis?: Basis;
  editing: boolean;
  candidates?: string[];
  suffix?: string;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: string | number | null) => void;
  onRevert: () => void;
};

const INPUT_CLASS = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-[14px] focus:border-zinc-400 focus:outline-none focus:ring-4 focus:ring-accent/20';

const TONE_CLASS: Record<string, string> = {
  src: 'bg-zinc-100 text-zinc-700',
  hyp: 'bg-zinc-100 text-zinc-700',
  ai: 'bg-accent-soft text-accent-ink',
  miss: 'bg-caution-soft text-caution',
  gray: 'bg-zinc-100 text-zinc-600',
  ok: 'bg-success-soft text-success',
  edit: 'bg-accent-soft text-accent-ink',
  lock: 'bg-zinc-200 text-zinc-800',
};

export function BasisBadge({ basis }: { basis: Basis }) {
  return (
    <span className={`rounded-full px-2 py-[1px] text-[11px] font-semibold ${TONE_CLASS[basis.tone] ?? TONE_CLASS.gray}`}>
      {basis.label}
    </span>
  );
}

export function EditedBadge() {
  return <span className="rounded-full bg-fuchsia-50 px-2 py-[1px] text-[11px] font-semibold text-fuchsia-700">編集済み</span>;
}

function Editor({
  type,
  initial,
  candidates,
  onCancel,
  onSave,
  onRevert,
  edited,
}: {
  type: EditType;
  initial: string | number | null;
  candidates: string[];
  onCancel: () => void;
  onSave: (value: string | number | null) => void;
  onRevert: () => void;
  edited: boolean;
}) {
  const [draft, setDraft] = useState<string>(initial === null || initial === undefined ? '' : String(initial));

  const commit = () => {
    if (type === 'number') {
      const n = draft.trim() === '' ? null : Number(draft);
      onSave(n === null || Number.isFinite(n) ? n : null);
      return;
    }
    onSave(draft.trim() === '' ? null : draft.trim());
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
      {type === 'multiline' ? (
        <textarea
          aria-label="編集内容"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className={INPUT_CLASS}
        />
      ) : type === 'month' ? (
        <input aria-label="編集内容" type="month" value={draft} onChange={(e) => setDraft(e.target.value)} className={INPUT_CLASS} />
      ) : type === 'number' ? (
        <input aria-label="編集内容" type="number" step="any" value={draft} onChange={(e) => setDraft(e.target.value)} className={INPUT_CLASS} />
      ) : (
        <>
          <input
            aria-label="編集内容"
            type="text"
            list={type === 'owner' ? 'execution-plan-owners' : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={INPUT_CLASS}
            placeholder={type === 'owner' ? '候補から選ぶ、または名前を入力' : undefined}
          />
          {type === 'owner' && candidates.length > 0 && (
            <datalist id="execution-plan-owners">
              {candidates.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={commit} className="rounded-xl bg-accent-action px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover">
          保存して閲覧に戻る
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] text-zinc-700 hover:bg-zinc-50">
          キャンセル
        </button>
        {edited && (
          <button type="button" onClick={onRevert} className="px-2 py-1.5 text-[12px] text-zinc-600 underline">
            元の内容に戻す
          </button>
        )}
      </div>
    </div>
  );
}

export default function EditableField(props: Props) {
  const { label, value, original, edited, type, basis, editing, candidates = [], suffix, onStartEdit, onCancel, onSave, onRevert } = props;
  const shown = value === null || value === undefined || value === '' ? null : String(value);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-zinc-700">{label}</span>
        {basis && <BasisBadge basis={basis} />}
        {edited && <EditedBadge />}
        {!editing && (
          <button type="button" onClick={onStartEdit} className="text-[12px] font-semibold text-accent-ink hover:underline">
            編集
          </button>
        )}
      </div>
      {editing ? (
        <Editor
          key="editor"
          type={type}
          initial={value}
          candidates={candidates}
          onCancel={onCancel}
          onSave={onSave}
          onRevert={onRevert}
          edited={edited}
        />
      ) : (
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-900">
          {shown === null ? <span className="text-zinc-400">未設定</span> : `${shown}${suffix ?? ''}`}
        </div>
      )}
      {edited && !editing && original !== undefined && (
        <div className="text-[11px] text-zinc-500">元の内容：{original === null || original === '' ? '未設定' : String(original)}</div>
      )}
    </div>
  );
}
