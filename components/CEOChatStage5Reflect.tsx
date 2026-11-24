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

type Phase = 'idle' | 'loading' | 'done' | 'error';

const ERROR_GENERIC = '入力案を作れませんでした。時間をおいてもう一度お試しください。';
const ERROR_NO_RELEVANT = 'この相談には、このプロジェクトに関係する本人の言葉が見つかりませんでした。案件に関わる内容で相談すると、反映できます。';

/** 相談の回答から入力案を作り、選んでいる案件の「社内に協力を求める」欄へ直接入れる。保存はしない。 */
export default function CEOChatStage5Reflect({ question, answer, execKey, companyId, strategyId }: Props) {
  const selection = useSelectedProjectStore((st) => st.selection);
  const setDraft = useSelectedProjectStore((st) => st.setDraft);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorText, setErrorText] = useState(ERROR_GENERIC);

  const sameTarget =
    !!selection &&
    selection.companyId === companyId &&
    selection.strategyId === strategyId &&
    consultKeyOf(selection) === execKey;

  useEffect(() => {
    if (!sameTarget) setPhase('idle');
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

  const reflect = async () => {
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
      if (res.status === 422) {
        setErrorText(ERROR_NO_RELEVANT);
        setPhase('error');
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as { text?: unknown };
      if (typeof json.text !== 'string' || json.text.trim() === '') throw new Error('empty draft');
      setDraft(
        { companyId, strategyId, departmentId: selection.departmentId, projectId: selection.projectId },
        json.text,
      );
      setPhase('done');
    } catch {
      setPhase('error');
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200 pt-2 text-[12px] text-zinc-700" aria-label="STAGE5への反映">
      <button
        type="button"
        onClick={() => void reflect()}
        disabled={phase === 'loading'}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:text-zinc-400"
      >
        STAGE5に反映
      </button>
      {phase === 'loading' ? <p className="text-zinc-500">入力案を作成しています…</p> : null}
      {phase === 'done' ? (
        <p className="text-zinc-600">
          STAGE5の「社内に協力を求める」欄に入れました。本人の言葉は相談文からそのまま選んでいます。内容を確認・編集し、「社内に共有する」を押すまで保存されません。
        </p>
      ) : null}
      {phase === 'error' ? <p className="text-zinc-600">{errorText}</p> : null}
    </div>
  );
}
