'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import { consultKeyOf, useSelectedProjectStore } from '@/lib/stage5/selectedProjectStore';

type Props = {
  question: string;
  answer: string;
  execKey: string;
  companyId: string;
  strategyId: string;
};

type Phase = 'idle' | 'loading' | 'preview' | 'done' | 'error';

/** 相談の回答を、選んでいる案件のSTAGE5入力欄へ反映する。作るだけで保存はしない。 */
export default function CEOChatStage5Reflect({ question, answer, execKey, companyId, strategyId }: Props) {
  const selection = useSelectedProjectStore((st) => st.selection);
  const setDraft = useSelectedProjectStore((st) => st.setDraft);
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');

  const sameTarget =
    !!selection &&
    selection.companyId === companyId &&
    selection.strategyId === strategyId &&
    consultKeyOf(selection) === execKey;

  useEffect(() => {
    if (!sameTarget) {
      setPhase((p) => (p === 'preview' || p === 'error' ? 'idle' : p));
      setText('');
    }
  }, [sameTarget]);

  if (!selection) {
    return (
      <p className="mt-2 border-t border-zinc-200 pt-2 text-[12px] text-zinc-500">
        STAGE5で案件を選ぶと、この回答を入力案として反映できます。
      </p>
    );
  }
  if (!sameTarget) {
    return (
      <p className="mt-2 border-t border-zinc-200 pt-2 text-[12px] text-zinc-500">
        選んでいる案件と違う相談のため、この回答は反映できません。
      </p>
    );
  }

  const create = async () => {
    setPhase('loading');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('no session');
      const res = await fetch('/api/stage5/consult-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyId,
          strategyId,
          departmentId: selection.departmentId,
          projectId: selection.projectId,
          question,
          answer,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as { text?: unknown };
      if (typeof json.text !== 'string' || json.text.trim() === '') throw new Error('empty draft');
      setText(json.text);
      setPhase('preview');
    } catch {
      setPhase('error');
    }
  };

  const apply = () => {
    setDraft(
      { companyId, strategyId, departmentId: selection.departmentId, projectId: selection.projectId },
      text,
    );
    setText('');
    setPhase('done');
  };

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200 pt-2 text-[12px] text-zinc-700" aria-label="STAGE5への反映">
      {phase === 'idle' || phase === 'error' ? (
        <>
          <button
            type="button"
            onClick={() => void create()}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-900 hover:bg-zinc-50"
          >
            STAGE5に反映
          </button>
          {phase === 'error' ? (
            <p className="text-zinc-600">入力案を作れませんでした。時間をおいてもう一度お試しください。</p>
          ) : null}
        </>
      ) : null}
      {phase === 'loading' ? <p className="text-zinc-500">入力案を作成しています…</p> : null}
      {phase === 'preview' ? (
        <>
          <p className="font-semibold text-zinc-800">入力案（確認してから反映します）</p>
          <p className="text-zinc-500">「私が困っていること」は、ご自身の相談文からそのまま選んだ言葉です。反映後も、社内共有の入力欄で編集できます。</p>
          <div className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-zinc-900">{text}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-accent-action px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover"
            >
              STAGE5の入力欄に反映
            </button>
            <button
              type="button"
              onClick={() => {
                setText('');
                setPhase('idle');
              }}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] text-zinc-700 hover:bg-zinc-50"
            >
              やめる
            </button>
          </div>
        </>
      ) : null}
      {phase === 'done' ? (
        <p className="text-zinc-600">STAGE5の入力欄に反映しました。内容を確認し、保存ボタンを押すまで保存されません。</p>
      ) : null}
    </div>
  );
}
