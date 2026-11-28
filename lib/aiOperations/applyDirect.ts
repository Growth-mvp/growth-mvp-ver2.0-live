// 通常の入力操作の反映。依頼そのものを入力の意思表示とみなし、既存の入力欄（ストア）へ直接反映する。
// 保存はしない。保存は画面の既存の手動保存と同じ仕様に従う。
// 未保存の変更があっても止めず、対象の項目だけを更新する。他の利用者による更新と企業・戦略の切り替えは保護する。
import { supabase } from '@/utils/supabase/client';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { OPERATION_ROLE_DENIED, proposalStaleReason, roleMeetsRequirement } from './guard';
import type { OperationProposal } from './instruction';
import type { StageOp } from './stage1Input';

export type Row = { year: number; revenue?: number | null } & Record<string, unknown>;

export type DirectProposal =
  | Extract<OperationProposal, { kind: 'stage1.issue' }>
  | Extract<OperationProposal, { kind: 'stage1.revenue' }>;

export type DirectApplyResult = { ok: boolean; message: string };

type FinanceOp = Extract<StageOp, { kind: 'finance' }>;
type Written = { ok: true; message: string; flash?: string } | { ok: false; message: string };

const AUTH_FAILED = '権限の確認ができませんでした。所属と権限を確認して、もう一度お試しください。';
const REVISION_CHANGED = 'ほかの画面で内容が更新されたため、反映しませんでした。画面を再読み込みして、もう一度指示してください。';
const SCOPE_CHANGED = '企業または戦略が切り替わったため、反映しませんでした。';
const SAVE_NOTE = '保存はまだです。内容を確かめ、必要に応じて修正してから保存してください。';
const PROFILE_LABEL: Record<string, string> = {
  companyName: '会社名',
  industry: '業種',
  location: '本社所在地',
  employees: '従業員数',
  fiscalYearEnd: '決算月',
};

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

function opOfDirectProposal(p: DirectProposal): StageOp {
  if (p.kind === 'stage1.issue') return { kind: 'issue.add', title: p.title, description: p.description };
  return { kind: 'finance', table: 'pl', key: 'revenue', label: '売上高', year: p.year, yen: p.afterYen };
}

function currentFor(proposal: DirectProposal) {
  const st = useStrategyStore.getState();
  if (proposal.kind === 'stage1.revenue') {
    return { revenueYen: revenueOf(st.financePL as Row[] | undefined, proposal.year) };
  }
  return { stage1IssueTitles: ((st.stage1Issues ?? []) as Array<{ title?: string }>).map((i) => i.title ?? '') };
}

function withYearValue<T extends { year: number }>(rows: T[], year: number, key: string, yen: number): T[] {
  const idx = rows.findIndex((r) => r.year === year);
  if (idx >= 0) return rows.map((r, i) => (i === idx ? { ...r, [key]: yen } : r));
  return [...rows, { year, [key]: yen } as unknown as T].sort((a, b) => a.year - b.year);
}

function currentYearValue(rows: Array<{ year: number }>, year: number, key: string): number | null {
  const v = (rows.find((r) => r.year === year) as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'number' ? v : null;
}

function newSegmentId(): string {
  return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function writeFinance(op: FinanceOp): Written {
  const st = useStrategyStore.getState();
  if (op.segment) {
    const segIndex = (st.businessSegments ?? []).findIndex((s) => s.name === op.segment);
    if (segIndex < 0) return { ok: false, message: `事業「${op.segment}」が見つかりません。反映しませんでした。` };
    const current = (((op.table === 'pl' ? st.segmentPL : st.segmentBS) ?? {}) as Record<string, Array<{ year: number }>>)[op.segment] ?? [];
    if (op.expectedBefore !== undefined && currentYearValue(current, op.year, op.key) !== op.expectedBefore) {
      return { ok: false, message: '入力案を作った後に値が変わったため、反映しませんでした。もう一度指示してください。' };
    }
    const next = withYearValue(current, op.year, op.key, op.yen);
    if (op.table === 'pl') st.upsertSegmentPL(op.segment, next as never);
    else st.upsertSegmentBS(op.segment, next as never);
    return {
      ok: true,
      message: `「${op.segment}」の${op.year}年度の${op.label}を${formatYen(op.yen)}として入力欄に反映しました。${SAVE_NOTE}`,
      flash: `stage1.segment.${segIndex}`,
    };
  }
  const rows = ((op.table === 'pl' ? st.financePL : st.financeBS) ?? []) as Array<{ year: number }>;
  if (op.expectedBefore !== undefined && currentYearValue(rows, op.year, op.key) !== op.expectedBefore) {
    return { ok: false, message: '入力案を作った後に値が変わったため、反映しませんでした。もう一度指示してください。' };
  }
  const next = withYearValue(rows, op.year, op.key, op.yen);
  if (op.table === 'pl') {
    st.setFinancePL(next as never);
    if (useStrategyStore.getState().financePL !== next) {
      return { ok: false, message: `${op.label}を反映できませんでした。年度と金額を確かめて、もう一度指示してください。` };
    }
  } else {
    st.setFinanceBS(next as never);
    if (useStrategyStore.getState().financeBS !== next) {
      return { ok: false, message: `${op.label}を反映できませんでした。年度と金額を確かめて、もう一度指示してください。` };
    }
  }
  return {
    ok: true,
    message: `${op.year}年度の${op.label}を${formatYen(op.yen)}として入力欄に反映しました。${SAVE_NOTE}`,
    flash: `stage1.finance.${op.table}.${op.key}.${op.year}`,
  };
}

function writeOp(op: StageOp): Written {
  const st = useStrategyStore.getState();
  switch (op.kind) {
    case 'issue.add': {
      const issues = (st.stage1Issues ?? []) as Array<{ title?: string } & Record<string, unknown>>;
      if (issues.length >= 5) return { ok: false, message: '経営課題が5件あるため、反映しませんでした。' };
      if (issues.some((i) => i.title === op.title)) return { ok: false, message: '同じ経営課題がすでにあるため、反映しませんでした。' };
      const next = [...issues, { title: op.title, description: op.description, linkedMetrics: [], scope: 'company' as const }];
      st.setStage1Issues(next as never);
      return {
        ok: true,
        message: `経営課題に「${op.title}」を追加し、入力欄に反映しました。${SAVE_NOTE}`,
        flash: `stage1.issue.${next.length - 1}`,
      };
    }
    case 'issue.edit': {
      const issues = (st.stage1Issues ?? []) as Array<{ title?: string } & Record<string, unknown>>;
      const idx = issues.findIndex((i) => i.title === op.title);
      if (idx < 0) return { ok: false, message: `経営課題「${op.title}」が見つかりません。反映しませんでした。` };
      if (op.field === 'title' && issues.some((i, j) => j !== idx && i.title === op.value)) {
        return { ok: false, message: '同じ題名の経営課題がすでにあるため、反映しませんでした。' };
      }
      const next = issues.map((issue, i) => (i === idx ? { ...issue, [op.field]: op.value } : issue));
      st.setStage1Issues(next as never);
      const what = op.field === 'title' ? '題名' : op.field === 'description' ? '説明文' : op.field === 'scope' ? '対象範囲' : '根拠となる指標';
      return { ok: true, message: `経営課題「${op.title}」の${what}を入力欄に反映しました。${SAVE_NOTE}`, flash: `stage1.issue.${idx}` };
    }
    case 'profile': {
      st.setProfile({ [op.field]: op.value } as never);
      return {
        ok: true,
        message: `${PROFILE_LABEL[op.field]}を「${op.display}」として入力欄に反映しました。${SAVE_NOTE}`,
        flash: `stage1.profile.${op.field}`,
      };
    }
    case 'segment.add': {
      const segs = st.businessSegments ?? [];
      if (segs.length >= 10) return { ok: false, message: '事業は10件までのため、反映しませんでした。' };
      if (segs.some((s) => s.name === op.name)) return { ok: false, message: `「${op.name}」という事業はすでにあります。` };
      st.setProfile({ businessSegments: [...segs, { id: newSegmentId(), name: op.name }] } as never);
      return {
        ok: true,
        message: `事業「${op.name}」を追加し、入力欄に反映しました。${SAVE_NOTE}`,
        flash: `stage1.segment.${segs.length}`,
      };
    }
    case 'segment.rename': {
      const segs = st.businessSegments ?? [];
      const idx = segs.findIndex((s) => s.name === op.from);
      if (idx < 0) return { ok: false, message: `事業「${op.from}」が見つかりません。反映しませんでした。` };
      if (segs.some((s, i) => i !== idx && s.name === op.to)) return { ok: false, message: `「${op.to}」という事業はすでにあります。` };
      st.setProfile({ businessSegments: segs.map((s, i) => (i === idx ? { ...s, name: op.to } : s)) } as never);
      return {
        ok: true,
        message: `事業名を「${op.from}」から「${op.to}」に変更し、入力欄に反映しました。${SAVE_NOTE}`,
        flash: `stage1.segment.${idx}`,
      };
    }
    case 'segment.set': {
      const segs = st.businessSegments ?? [];
      const idx = segs.findIndex((s) => s.name === op.name);
      if (idx < 0) return { ok: false, message: `事業「${op.name}」が見つかりません。反映しませんでした。` };
      const field = op.field;
      const next = segs.map((s, i) => (i === idx ? { ...s, [field]: op.value } : s));
      st.setProfile({ businessSegments: next } as never);
      return {
        ok: true,
        message: `「${op.name}」の${field === 'keyCustomers' ? '主な顧客' : field === 'summary' ? '事業概要' : '展開地域'}を入力欄に反映しました。${SAVE_NOTE}`,
        flash: `stage1.segment.${idx}`,
      };
    }
    case 'finance':
      return writeFinance(op);
    case 'wacc': {
      st.setStage1Benchmarks({ ...((st.stage1Benchmarks ?? {}) as object), waccManual: op.pct } as never);
      return { ok: true, message: `WACCを${op.pct}%として入力欄に反映しました。${SAVE_NOTE}`, flash: 'stage1.assumption.wacc' };
    }
    case 'valuation': {
      st.recomputeValueAnalysis();
      return { ok: true, message: '企業価値分析を更新しました。結果は「企業価値分析」の欄に表示されます。' };
    }
  }
}

/** 入力操作を、画面の入力欄（ストア）へ反映する。権限・企業/戦略・他の利用者による更新を確かめてから書く */
export async function applyStageOp(op: StageOp): Promise<DirectApplyResult> {
  try {
    if (!roleMeetsRequirement(useUserStore.getState().role ?? null, 'manager')) {
      return { ok: false, message: OPERATION_ROLE_DENIED };
    }
    const before = useStrategyStore.getState();
    if (!before.companyId || !before.strategyId) return { ok: false, message: SCOPE_CHANGED };

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = token
      ? await fetch('/api/ai-operations/authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ companyId: before.companyId, strategyId: before.strategyId, operation: 'stage1.input' }),
        })
      : null;
    if (!res || !res.ok) return { ok: false, message: AUTH_FAILED };
    const { revision } = (await res.json()) as { revision?: number };

    const after = useStrategyStore.getState();
    if (typeof revision !== 'number' || after.revision !== revision) return { ok: false, message: REVISION_CHANGED };

    const written = writeOp(op);
    if (!written.ok) return written;
    if (written.flash) useAiHighlightStore.getState().flash(written.flash);
    return { ok: true, message: written.message };
  } catch {
    return { ok: false, message: '反映の途中で問題が起きました。画面を再読み込みして、内容を確かめてください。' };
  }
}

/** 経営課題の追加・売上の空欄への入力などの入力案を、入力欄へ直接反映する */
export async function applyDirectProposal(proposal: OperationProposal): Promise<DirectApplyResult> {
  if (!isDirectProposal(proposal)) return { ok: false, message: 'この操作は、入力欄への直接反映の対象ではありません。' };
  const st = useStrategyStore.getState();
  if (st.companyId !== proposal.companyId || st.strategyId !== proposal.strategyId) return { ok: false, message: SCOPE_CHANGED };
  const stale = proposalStaleReason(proposal, currentFor(proposal));
  if (stale) return { ok: false, message: stale.message };
  return applyStageOp(opOfDirectProposal(proposal));
}
