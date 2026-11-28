// 通常の入力操作の反映。依頼そのものを入力の意思表示とみなし、既存の入力欄（ストア）へ直接反映する。
// 保存はしない。保存は画面の既存の手動保存と同じ仕様に従う。
import { supabase } from '@/utils/supabase/client';
import { useStrategyStore } from '@/store/strategyStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { proposalBlockReason, proposalStaleReason } from './guard';
import type { OperationProposal } from './instruction';

export type Row = { year: number; revenue?: number | null } & Record<string, unknown>;

export type DirectProposal =
  | Extract<OperationProposal, { kind: 'stage1.issue' }>
  | Extract<OperationProposal, { kind: 'stage1.revenue' }>;

export type DirectApplyResult = { ok: boolean; message: string };

const AUTH_FAILED = '権限の確認ができませんでした。所属と権限を確認して、もう一度お試しください。';
const REVISION_CHANGED = 'ほかの画面で内容が更新されたため、反映しませんでした。画面を再読み込みして、もう一度指示してください。';
const ISSUE_FULL = '経営課題が5件あるため、反映しませんでした。';
const SAVE_NOTE = '保存はまだです。内容を確かめ、必要に応じて修正してから保存してください。';

export function isDirectProposal(proposal: OperationProposal): proposal is DirectProposal {
  if (proposal.kind === 'stage1.issue') return true;
  return proposal.kind === 'stage1.revenue' && proposal.beforeYen === null;
}

export function formatYen(yen: number | null): string {
  if (yen === null) return '未登録';
  return `${yen.toLocaleString('ja-JP')}円（${(yen / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円）`;
}

export function revenueOf(rows: Row[] | undefined, year: number): number | null {
  const row = (rows ?? []).find((r) => r.year === year);
  return typeof row?.revenue === 'number' ? row.revenue : null;
}

function currentFor(proposal: DirectProposal) {
  const st = useStrategyStore.getState();
  if (proposal.kind === 'stage1.revenue') {
    return { revenueYen: revenueOf(st.financePL as Row[] | undefined, proposal.year) };
  }
  return { stage1IssueTitles: ((st.stage1Issues ?? []) as Array<{ title?: string }>).map((i) => i.title ?? '') };
}

/** 入力案の内容を、画面の入力欄（ストア）へ反映する。権限・対象・更新の有無・未保存の変更を確かめてから書く */
export async function applyDirectProposal(proposal: OperationProposal): Promise<DirectApplyResult> {
  if (!isDirectProposal(proposal)) return { ok: false, message: 'この操作は、入力欄への直接反映の対象ではありません。' };
  try {
    const before = useStrategyStore.getState();
    const screen = {
      companyId: before.companyId ?? null,
      strategyId: before.strategyId ?? null,
      pathname: proposal.pathname,
      dirty: Boolean(before.dirty),
    };
    const blocked = proposalBlockReason(proposal, screen);
    if (blocked) return { ok: false, message: blocked.message };
    const stale = proposalStaleReason(proposal, currentFor(proposal));
    if (stale) return { ok: false, message: stale.message };

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
    if (!res || !res.ok) return { ok: false, message: AUTH_FAILED };
    const { revision } = (await res.json()) as { revision?: number };

    const after = useStrategyStore.getState();
    if (typeof revision !== 'number' || after.revision !== revision) return { ok: false, message: REVISION_CHANGED };
    const reRead = proposalBlockReason(proposal, {
      companyId: after.companyId ?? null,
      strategyId: after.strategyId ?? null,
      pathname: proposal.pathname,
      dirty: Boolean(after.dirty),
    });
    if (reRead) return { ok: false, message: reRead.message };

    if (proposal.kind === 'stage1.issue') {
      const issues = (after.stage1Issues ?? []) as Array<{ title?: string } & Record<string, unknown>>;
      if (issues.length >= 5) return { ok: false, message: ISSUE_FULL };
      const nextIssues = [
        ...issues,
        { title: proposal.title, description: proposal.description, linkedMetrics: [], scope: 'company' as const },
      ];
      after.setStage1Issues(nextIssues as never);
      useAiHighlightStore.getState().flash(`stage1.issue.${nextIssues.length - 1}`);
      return { ok: true, message: `経営課題に「${proposal.title}」を追加し、入力欄に反映しました。${SAVE_NOTE}` };
    }

    const prevPL = (after.financePL ?? []) as Row[];
    const idx = prevPL.findIndex((r) => r.year === proposal.year);
    const nextPL: Row[] =
      idx >= 0
        ? prevPL.map((r, i) => (i === idx ? { ...r, revenue: proposal.afterYen } : r))
        : [...prevPL, { year: proposal.year, revenue: proposal.afterYen }].sort((a, b) => a.year - b.year);
    after.setFinancePL(nextPL as never);
    if (useStrategyStore.getState().financePL !== nextPL) {
      return { ok: false, message: '売上高を反映できませんでした。年度と金額を確かめて、もう一度指示してください。' };
    }
    useAiHighlightStore.getState().flash(`stage1.finance.pl.revenue.${proposal.year}`);
    return {
      ok: true,
      message: `${proposal.year}年度の全社売上高を${formatYen(proposal.afterYen)}として入力欄に反映しました。${SAVE_NOTE}`,
    };
  } catch {
    return { ok: false, message: '反映の途中で問題が起きました。画面を再読み込みして、内容を確かめてください。' };
  }
}
