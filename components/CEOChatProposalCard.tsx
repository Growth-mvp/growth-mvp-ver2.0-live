// /components/CEOChatProposalCard.tsx
'use client';

import React, { useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import { useStrategyStore } from '@/store/strategyStore';
import { summaryFollowsPL } from '@/lib/autofill/financeWrite';
import { appendCeoIntent, type OperationProposal } from '@/lib/aiOperations/instruction';
import { proposalBlockReason, proposalStaleReason } from '@/lib/aiOperations/guard';
import { useOperationProposalStore } from '@/lib/aiOperations/proposalStore';

type Props = {
  proposal: OperationProposal;
  pathname: string;
  onResult: (message: string) => void;
};

type Row = { year: number; revenue?: number | null } & Record<string, unknown>;

function formatYen(yen: number | null): string {
  if (yen === null) return '未登録';
  return `${yen.toLocaleString('ja-JP')}円（${(yen / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円）`;
}

/** 入力案の確認と承認。承認するまで保存しない。承認後は、会社・画面・値を確かめ直してから既存の保存処理で保存する */
export default function CEOChatProposalCard({ proposal, pathname, onResult }: Props) {
  const [addition, setAddition] = useState(proposal.kind === 'stage2.ceoIntent' ? proposal.addition : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discard = (message: string) => {
    useOperationProposalStore.getState().clearPending();
    onResult(message);
  };

  const approve = async () => {
    if (busy) return;
    const st = useStrategyStore.getState();
    const screen = {
      companyId: st.companyId ?? null,
      strategyId: st.strategyId ?? null,
      pathname,
      dirty: Boolean(st.dirty),
    };
    const blocked = proposalBlockReason(proposal, screen);
    if (blocked) {
      if (blocked.discard) discard(blocked.message);
      else setError(blocked.message);
      return;
    }
    const current =
      proposal.kind === 'stage2.ceoIntent'
        ? { ceoIntent: st.ceoIntent ?? '' }
        : { revenueYen: revenueOf(st.financePL as Row[] | undefined, proposal.year) };
    const stale = proposalStaleReason(proposal, current);
    if (stale) {
      discard(stale.message);
      return;
    }
    if (proposal.kind === 'stage2.ceoIntent' && addition.trim() === '') {
      setError('追加する文を入力してください。');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = token
        ? await fetch('/api/ai-operations/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              companyId: proposal.companyId,
              strategyId: proposal.strategyId,
              operation: proposal.kind,
              ...(proposal.kind === 'stage1.revenue' ? { year: proposal.year } : {}),
            }),
          })
        : null;
      if (!res || !res.ok) {
        setError('承認の確認ができませんでした。所属と権限を確認して、もう一度お試しください。');
        return;
      }
      const { revision: serverRevision } = (await res.json()) as { revision?: number };

      const after = useStrategyStore.getState();
      if (typeof serverRevision !== 'number' || after.revision !== serverRevision) {
        discard('ほかの画面で内容が更新されたため、入力案を破棄しました。保存していません。もう一度指示してください。');
        return;
      }
      const reRead = proposalBlockReason(proposal, {
        companyId: after.companyId ?? null,
        strategyId: after.strategyId ?? null,
        pathname,
        dirty: Boolean(after.dirty),
      });
      if (reRead) {
        if (reRead.discard) discard(reRead.message);
        else setError(reRead.message);
        return;
      }

      if (proposal.kind === 'stage2.ceoIntent') {
        const prev = after.ceoIntent ?? '';
        after.setCeoIntent(appendCeoIntent(proposal.before, addition));
        const saved = await useStrategyStore.getState().saveStrategyData({ reason: 'stage2:ai-operation', conflictRetry: false });
        if (!saved.ok) {
          useStrategyStore.getState().setCeoIntent(prev);
          setError('保存できませんでした。入力内容は画面に戻しています。もう一度お試しください。');
          return;
        }
        discard('「経営者の思い」に追加して保存しました。再読込しても残っています。');
        return;
      }

      const prevPL = (after.financePL ?? []) as Row[];
      const prevSummary = after.financeSummary;
      const idx = prevPL.findIndex((r) => r.year === proposal.year);
      const nextPL: Row[] =
        idx >= 0
          ? prevPL.map((r, i) => (i === idx ? { ...r, revenue: proposal.afterYen } : r))
          : [...prevPL, { year: proposal.year, revenue: proposal.afterYen }].sort((a, b) => a.year - b.year);
      after.setFinancePL(nextPL as never);
      const summary = summaryFollowsPL(prevSummary, prevPL, nextPL);
      if (summary) useStrategyStore.getState().setFinanceSummary(summary as never);
      const saved = await useStrategyStore.getState().saveStrategyData({ reason: 'stage1:ai-operation', conflictRetry: false });
      if (!saved.ok) {
        useStrategyStore.getState().setFinancePL(prevPL as never);
        if (summary) useStrategyStore.getState().setFinanceSummary(prevSummary as never);
        setError('保存できませんでした。入力内容は画面に戻しています。もう一度お試しください。');
        return;
      }
      discard(`${proposal.year}年度の全社売上高を${formatYen(proposal.afterYen)}で保存しました。企業価値分析にも同じ値が使われます。`);
    } catch {
      setError('保存の結果を確認できませんでした。画面を再読み込みして、内容を確かめてください。');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    useOperationProposalStore.getState().clearPending();
    onResult('入力案を取り消しました。保存していません。');
  };

  const isConflict = proposal.kind === 'stage1.revenue' && proposal.beforeYen !== null;
  const ceoPreview = proposal.kind === 'stage2.ceoIntent' ? appendCeoIntent(proposal.before, addition) : '';

  return (
    <section aria-label="入力案の確認" className="mb-2 max-w-[90%] space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-zinc-900">
      <p className="font-semibold">入力案（まだ保存していません）</p>
      {proposal.kind === 'stage2.ceoIntent' ? (
        <>
          <p className="text-zinc-700">対象：STAGE2「経営者の思い」（既存の文章は残し、末尾に追加します）</p>
          <label className="block text-[12px] text-zinc-700">
            追加する文（編集できます）
            <textarea
              value={addition}
              onChange={(e) => setAddition(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white p-2 text-[13px] text-zinc-900"
              disabled={busy}
            />
          </label>
          <div className="rounded-md bg-white p-2 text-[12px] text-zinc-700">
            <p className="mb-1 font-medium text-zinc-600">保存後の内容</p>
            <p className="whitespace-pre-wrap">{ceoPreview}</p>
          </div>
        </>
      ) : (
        <>
          <p className="text-zinc-700">
            対象：STAGE1 財務（全社・{proposal.year}年度の売上高）
          </p>
          <p>
            現在：{formatYen(proposal.beforeYen)}
            <br />
            入力案：{formatYen(proposal.afterYen)}
          </p>
          {isConflict ? (
            <p className="text-rose-700">登録済みの値を、入力案の値に置き換えます。内容を確かめてから承認してください。</p>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void approve()}
          disabled={busy || (proposal.kind === 'stage2.ceoIntent' && addition.trim() === '')}
          className="rounded-lg bg-accent-action px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:bg-zinc-300"
        >
          {busy ? '保存しています…' : isConflict ? '既存の値を置き換えて保存' : '承認して保存'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] text-zinc-700 hover:bg-zinc-50"
        >
          取り消す
        </button>
      </div>
      {error ? (
        <p role="status" className="text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function revenueOf(rows: Row[] | undefined, year: number): number | null {
  const row = (rows ?? []).find((r) => r.year === year);
  return typeof row?.revenue === 'number' ? row.revenue : null;
}
