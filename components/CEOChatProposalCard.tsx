// /components/CEOChatProposalCard.tsx
'use client';

import React, { useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import { useStrategyStore } from '@/store/strategyStore';
import { summaryFollowsPL } from '@/lib/autofill/financeWrite';
import { appendCeoIntent, contextDepartments, stage3AnswerOf, type OperationProposal } from '@/lib/aiOperations/instruction';
import { proposalBlockReason, proposalStaleReason } from '@/lib/aiOperations/guard';
import { useOperationProposalStore } from '@/lib/aiOperations/proposalStore';
import { planStore } from '@/lib/aiOperations/stage4Client';
import { useUserStore } from '@/store/userStore';

const SAVE_FAILED_MESSAGE =
  '保存されませんでした。ほかの画面で内容が更新された可能性があります。保存済みのデータは変わっていません。画面を再読み込みして、内容を確かめてからもう一度指示してください。';

type Props = {
  proposal: OperationProposal;
  pathname: string;
  onResult: (message: string) => void;
};

type Row = { year: number; revenue?: number | null } & Record<string, unknown>;
type StoreStep = { stepNumber: number; question: string; reason?: string; answer: string } & Record<string, unknown>;
type StoreDept = { name: string; answers2?: Array<{ chapterIndex: number; chapterTitle: string; steps: StoreStep[] } & Record<string, unknown>> } & Record<string, unknown>;

function formatYen(yen: number | null): string {
  if (yen === null) return '未登録';
  return `${yen.toLocaleString('ja-JP')}円（${(yen / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円）`;
}

function revenueOf(rows: Row[] | undefined, year: number): number | null {
  const row = (rows ?? []).find((r) => r.year === year);
  return typeof row?.revenue === 'number' ? row.revenue : null;
}

/** 入力案の確認と承認。承認するまで保存しない。承認後は、会社・画面・revision を確かめ直してから既存の保存処理で保存する */
export default function CEOChatProposalCard({ proposal, pathname, onResult }: Props) {
  const [addition, setAddition] = useState(
    proposal.kind === 'stage2.ceoIntent' ? proposal.addition : proposal.kind === 'stage3.question' ? proposal.answer : '',
  );
  const needsText = proposal.kind === 'stage2.ceoIntent' || proposal.kind === 'stage3.question';
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
        : proposal.kind === 'stage3.question'
          ? { stage3Answer: stage3AnswerOf(contextDepartments(st.departments as unknown as StoreDept[]), proposal.departmentName, proposal.stepNumber) }
          : proposal.kind === 'stage4.plan'
            ? { stage4Version: proposal.expectedVersion }
            : { revenueYen: revenueOf(st.financePL as Row[] | undefined, proposal.year) };
    const stale = proposalStaleReason(proposal, current);
    if (stale) {
      discard(stale.message);
      return;
    }
    if (needsText && addition.trim() === '') {
      setError('入力してください。');
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
      if (proposal.kind === 'stage4.plan') {
        await approveStage4(proposal, discard, setError);
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
        const nextIntent = appendCeoIntent(proposal.before, addition).trim();
        const saved = await useStrategyStore.getState().saveStrategyData({
          reason: 'stage2:ai-operation',
          conflictRetry: false,
          patch: { ceoIntent: nextIntent },
        });
        if (!saved.ok) {
          setError(SAVE_FAILED_MESSAGE);
          return;
        }
        discard('「経営者の思い」に追加して保存しました。再読込しても残っています。');
        return;
      }

      if (proposal.kind === 'stage3.question') {
        const prevDepts = (after.departments ?? []) as unknown as StoreDept[];
        const idx = prevDepts.findIndex((d) => d.name === proposal.departmentName);
        if (idx < 0) {
          discard('部門が見つからないため、入力案を破棄しました。保存していません。');
          return;
        }
        const dept = prevDepts[idx];
        const chapters = dept.answers2 ?? [];
        const steps = (chapters[0]?.steps ?? []).map((s) => (s.stepNumber === proposal.stepNumber ? { ...s, answer: addition.trim() } : s));
        const nextChapters = [{ ...(chapters[0] ?? { chapterIndex: 0, chapterTitle: '6つの問い' }), steps }, ...chapters.slice(1)];
        const nextDepts = prevDepts.map((d, i) => (i === idx ? { ...d, answers2: nextChapters } : d));
        const saved = await useStrategyStore.getState().saveStrategyData({
          reason: 'stage3:ai-operation',
          conflictRetry: false,
          patch: { departments: nextDepts as never },
        });
        if (!saved.ok) {
          setError(SAVE_FAILED_MESSAGE);
          return;
        }
        discard(`${proposal.departmentName}の6つの問い ${proposal.stepNumber}番目に回答を保存しました。`);
        return;
      }

      const prevPL = (after.financePL ?? []) as Row[];
      const prevSummary = after.financeSummary;
      const idx = prevPL.findIndex((r) => r.year === proposal.year);
      const nextPL: Row[] =
        idx >= 0
          ? prevPL.map((r, i) => (i === idx ? { ...r, revenue: proposal.afterYen } : r))
          : [...prevPL, { year: proposal.year, revenue: proposal.afterYen }].sort((a, b) => a.year - b.year);
      const summary = summaryFollowsPL(prevSummary, prevPL, nextPL);
      const saved = await useStrategyStore.getState().saveStrategyData({
        reason: 'stage1:ai-operation',
        conflictRetry: false,
        patch: {
          financePL: nextPL as never,
          financeUnitConfirmed: { ...(after.financeUnitConfirmed ?? {}), pl: nextPL.map((r) => r.year) } as never,
          ...(summary ? { financeSummary: summary as never } : {}),
        },
      });
      if (!saved.ok) {
        setError(SAVE_FAILED_MESSAGE);
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

  const isConflict =
    (proposal.kind === 'stage1.revenue' && proposal.beforeYen !== null) || (proposal.kind === 'stage3.question' && proposal.before !== '');
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
      ) : proposal.kind === 'stage3.question' ? (
        <>
          <p className="text-zinc-700">
            対象：STAGE3「{proposal.departmentName}」の6つの問い {proposal.stepNumber}番目
          </p>
          <p className="rounded-md bg-white p-2 text-[12px] text-zinc-700">問い：{proposal.question}</p>
          <label className="block text-[12px] text-zinc-700">
            回答（編集できます）
            <textarea
              value={addition}
              onChange={(e) => setAddition(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white p-2 text-[13px] text-zinc-900"
              disabled={busy}
            />
          </label>
          <p className="text-[12px] text-zinc-600">現在の回答：{proposal.before || '（未回答）'}</p>
          {isConflict ? <p className="text-rose-700">登録済みの回答を、入力案の内容に置き換えます。内容を確かめてから承認してください。</p> : null}
        </>
      ) : proposal.kind === 'stage4.plan' ? (
        <>
          <p className="text-zinc-700">対象：STAGE4「{proposal.projectTitle}」の実行計画書（{proposal.departmentName}）</p>
          <ul className="space-y-1 rounded-md bg-white p-2 text-[12px] text-zinc-800">
            {proposal.changes.map((c) => (
              <li key={c.itemId}>
                <span className="font-medium">{c.label}</span>：{c.before || '（未入力）'} → <span className="font-medium">{c.after}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-zinc-600">承認すると、この項目だけを実行計画書に保存します。AIの草案は変わりません。</p>
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
          disabled={busy || (needsText && addition.trim() === '')}
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

async function approveStage4(
  proposal: Extract<OperationProposal, { kind: 'stage4.plan' }>,
  discard: (message: string) => void,
  setError: (message: string) => void,
) {
  const user = useUserStore.getState();
  const actor = { userId: user.user?.id ?? '', memberships: [{ companyId: proposal.companyId, role: user.role ?? 'member' }] };
  const key = { companyId: proposal.companyId, strategyId: proposal.strategyId, projectId: proposal.projectId };
  const loaded = await planStore().load(actor, key);
  if (loaded.status !== 'FOUND') {
    discard('実行計画書を読み込めなかったため、入力案を破棄しました。保存していません。');
    return;
  }
  const stale = proposalStaleReason(proposal, { stage4Version: loaded.record.version });
  if (stale) {
    discard(stale.message);
    return;
  }
  const userEdits = { ...(loaded.record.userEdits ?? {}), ...proposal.edits };
  const out = await planStore().update(actor, key, loaded.record.version, { userEdits, adopted: loaded.record.adopted });
  if (out.status === 'SAVED') {
    discard(`「${proposal.projectTitle}」の実行計画書に保存しました。STAGE4の画面で再読込すると、内容を確認できます。`);
    return;
  }
  if (out.status === 'CONFLICT') {
    discard('ほかで更新されたため保存しませんでした。保存済みの計画は変わっていません。計画書を開き直してから、もう一度指示してください。');
    return;
  }
  setError(SAVE_FAILED_MESSAGE);
}
