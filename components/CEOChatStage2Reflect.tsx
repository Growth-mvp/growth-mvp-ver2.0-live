'use client';

import { useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import { planCeoIntentReflect } from '@/lib/stage2/ceoIntent';
import { useIntentReflectStore } from '@/lib/stage2/intentReflectStore';
import { useStrategyStore } from '@/store/strategyStore';

type Props = {
  question: string;
  answer: string;
  companyId: string;
  strategyId: string;
};

type Phase = 'idle' | 'loading' | 'choice' | 'done' | 'error';

const ERROR_GENERIC = '経営者の思いを作れませんでした。時間をおいてもう一度お試しください。';
const ERROR_NO_RELEVANT = 'この相談には、経営者ご自身の思いとして入れられる言葉が見つかりませんでした。';

/** 相談の回答から、経営者本人の思いを作り、STAGE2の「経営者の思い」欄へ渡す。保存はしない。 */
export default function CEOChatStage2Reflect({ question, answer, companyId, strategyId }: Props) {
  const setPending = useIntentReflectStore((st) => st.setPending);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorText, setErrorText] = useState(ERROR_GENERIC);
  const [draftText, setDraftText] = useState('');

  const send = (text: string) => {
    setPending({ companyId, strategyId }, text);
    setDraftText('');
    setPhase('done');
  };

  const reflect = async () => {
    setPhase('loading');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('no session');
      const res = await fetch('/api/stage2/consult-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId, strategyId, question, answer }),
      });
      if (res.status === 422) {
        setErrorText(ERROR_NO_RELEVANT);
        setPhase('error');
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as { text?: unknown };
      if (typeof json.text !== 'string' || json.text.trim() === '') throw new Error('empty');
      const current = useStrategyStore.getState().ceoIntent ?? '';
      const plan = planCeoIntentReflect(current, json.text);
      if (plan.mode === 'apply') {
        send(json.text);
        return;
      }
      setDraftText(json.text);
      setPhase('choice');
    } catch {
      setErrorText(ERROR_GENERIC);
      setPhase('error');
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200 pt-2 text-[12px] text-zinc-700" aria-label="STAGE2への反映">
      {phase !== 'choice' ? (
        <button
          type="button"
          onClick={() => void reflect()}
          disabled={phase === 'loading'}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:text-zinc-400"
        >
          STAGE2に反映
        </button>
      ) : null}
      {phase === 'loading' ? <p className="text-zinc-500">経営者の思いを作成しています…</p> : null}
      {phase === 'choice' ? (
        <div className="space-y-2">
          <p className="text-zinc-700">
            STAGE2の「経営者の思い」欄には、すでに文章があります。末尾に追記するか、反映を中止するかを選んでください。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => send(draftText)}
              className="rounded-lg bg-accent-action px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover"
            >
              末尾に追記する
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftText('');
                setPhase('idle');
              }}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] text-zinc-700 hover:bg-zinc-50"
            >
              中止する
            </button>
          </div>
        </div>
      ) : null}
      {phase === 'done' ? (
        <p className="text-zinc-600">
          STAGE2の「経営者の思い」欄に入れました。本人の言葉をそのまま選んでいます。内容を確認・編集でき、入力内容は自動で保存されます。
        </p>
      ) : null}
      {phase === 'error' ? <p className="text-zinc-600">{errorText}</p> : null}
    </div>
  );
}
