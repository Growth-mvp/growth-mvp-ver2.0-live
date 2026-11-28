// 通常の入力操作の反映。依頼そのものを入力の意思表示とみなし、既存の入力欄（ストア）へ直接反映する。
// 保存はしない。保存は画面の既存の手動保存と同じ仕様に従う（自動保存の結果を待ち、画面の表示と同じ説明をする）。
// 未保存の変更があっても止めず、対象の項目だけを更新する。他の利用者による更新と企業・戦略の切り替えは保護する。
import { supabase } from '@/utils/supabase/client';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { saveStatusTypeOf } from '@/lib/strategy/saveStatus';
import { OPERATION_ROLE_DENIED, proposalStaleReason, roleMeetsRequirement } from './guard';
import type { OperationProposal } from './instruction';
import type { RemovalTarget, StageOp } from './stage1Input';
import { useAiUndoStore, type AiWriteRecord } from './aiUndoStore';
import { removalCheck, type RemovalOp } from './removalSafety';
import { buildBusinessPortfolio } from '@/lib/stage1/businessPortfolio';
import type { FinancePLRow, ValueAnalysis } from '@/types/strategy';
import { saveSentenceOf, waitForSaveSettled } from './saveSettle';

export type Row = { year: number; revenue?: number | null } & Record<string, unknown>;

export type DirectProposal =
  | Extract<OperationProposal, { kind: 'stage1.issue' }>
  | Extract<OperationProposal, { kind: 'stage1.revenue' }>;

export type DirectApplyResult = { ok: boolean; message: string };

/** settleMs: 自動保存を待つ時間（0 なら待たない）。recordUndo: 取り消しの対象として記録するか */
export type ApplyOptions = { settleMs?: number; recordUndo?: boolean };

type FinanceOp = Extract<StageOp, { kind: 'finance' }>;
type Written = { ok: true; message: string; flash?: string; undo: StageOp | null } | { ok: false; message: string };

const AUTH_FAILED = '権限の確認ができませんでした。所属と権限を確認して、もう一度お試しください。';
const REVISION_CHANGED = 'ほかの画面で内容が更新されたため、反映しませんでした。画面を再読み込みして、もう一度指示してください。';
const SCOPE_CHANGED = '企業または戦略が切り替わったため、反映しませんでした。';
const VALUE_CHANGED = '権限の確認中に同じ項目が変わったため、反映しませんでした。内容を確かめて、もう一度指示してください。';
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

/** 年度の行に値を入れる。null は値を空欄に戻す（行に他の値が残らなければ行ごと外す） */
function withYearValue<T extends { year: number }>(rows: T[], year: number, key: string, yen: number | null): T[] {
  const idx = rows.findIndex((r) => r.year === year);
  if (yen === null) {
    if (idx < 0) return rows;
    const row: Record<string, unknown> = { ...rows[idx] };
    delete row[key];
    const hasValues = Object.keys(row).some((k) => k !== 'year');
    return hasValues ? rows.map((r, i) => (i === idx ? (row as unknown as T) : r)) : rows.filter((_, i) => i !== idx);
  }
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

function financeValueOf(op: FinanceOp, st: StrategyState): number | null {
  const rows = op.segment
    ? (((op.table === 'pl' ? st.segmentPL : st.segmentBS) ?? {}) as Record<string, Array<{ year: number }>>)[op.segment] ?? []
    : (((op.table === 'pl' ? st.financePL : st.financeBS) ?? []) as Array<{ year: number }>);
  return currentYearValue(rows, op.year, op.key);
}

/** 入力対象の現在の値。権限確認の前後で比べ、確認中に同じ項目が変わっていれば上書きしない */
function valueSignatureOf(op: StageOp, st: StrategyState): string {
  const segments = (st.businessSegments ?? []) as Array<{ name: string } & Record<string, unknown>>;
  const issues = (st.stage1Issues ?? []) as Array<{ title?: string } & Record<string, unknown>>;
  switch (op.kind) {
    case 'profile':
      return JSON.stringify((st as unknown as Record<string, unknown>)[op.field] ?? null);
    case 'segment.add':
      return JSON.stringify(segments.find((s) => s.name === op.name) ?? null);
    case 'segment.remove':
      return JSON.stringify(segments.find((s) => s.id === op.id) ?? null);
    case 'segment.rename':
      return JSON.stringify(segments.map((s) => s.name));
    case 'segment.set':
      return JSON.stringify(segments.find((s) => s.name === op.name)?.[op.field] ?? null);
    case 'finance':
      return JSON.stringify(financeValueOf(op, st));
    case 'wacc':
      return JSON.stringify((st as unknown as { stage1Benchmarks?: { waccManual?: number } }).stage1Benchmarks?.waccManual ?? null);
    case 'issue.add':
    case 'issue.remove':
      return JSON.stringify(issues.find((i) => i.title === op.title) ?? null);
    case 'issue.edit':
      return JSON.stringify(issues.find((i) => i.title === op.title) ?? null);
    case 'valuation':
      return '';
  }
}

function financeMessage(op: FinanceOp, segmentName?: string): string {
  const subject = segmentName ? `「${segmentName}」の` : '';
  return op.yen === null
    ? `${subject}${op.year}年度の${op.label}を空欄に戻しました。`
    : `${subject}${op.year}年度の${op.label}を${formatYen(op.yen)}として入力欄に反映しました。`;
}

function writeFinance(op: FinanceOp): Written {
  const st = useStrategyStore.getState();
  const undo: StageOp = {
    kind: 'finance',
    table: op.table,
    key: op.key,
    label: op.label,
    year: op.year,
    yen: financeValueOf(op, st),
    ...(op.segment ? { segment: op.segment } : {}),
  };
  if (op.segment) {
    const segIndex = (st.businessSegments ?? []).findIndex((s) => s.name === op.segment);
    if (segIndex < 0) return { ok: false, message: `事業「${op.segment}」が見つかりません。反映しませんでした。` };
    const segId = (st.businessSegments ?? [])[segIndex].id;
    const current = (((op.table === 'pl' ? st.segmentPL : st.segmentBS) ?? {}) as Record<string, Array<{ year: number }>>)[op.segment] ?? [];
    if (op.expectedBefore !== undefined && currentYearValue(current, op.year, op.key) !== op.expectedBefore) {
      return { ok: false, message: '入力案を作った後に値が変わったため、反映しませんでした。もう一度指示してください。' };
    }
    const next = withYearValue(current, op.year, op.key, op.yen);
    if (op.table === 'pl') st.upsertSegmentPL(op.segment, next as never);
    else st.upsertSegmentBS(op.segment, next as never);
    return {
      ok: true,
      message: financeMessage(op, op.segment),
      flash: `stage1.finance.segment.${segId}.${op.table}.${op.key}.${op.year}`,
      undo,
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
    message: financeMessage(op),
    flash: `stage1.finance.${op.table}.${op.key}.${op.year}`,
    undo,
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
        message: `経営課題に「${op.title}」を追加し、入力欄に反映しました。`,
        flash: `stage1.issue.${next.length - 1}`,
        undo: { kind: 'issue.remove', title: op.title },
      };
    }
    case 'issue.remove': {
      const check = removalCheck(op, st);
      if (!check.ok) return { ok: false, message: check.reason };
      const issues = (st.stage1Issues ?? []) as Array<{ title?: string } & Record<string, unknown>>;
      const idx = issues.findIndex((i) => i.title === op.title);
      st.setStage1Issues(issues.filter((_, i) => i !== idx) as never);
      return { ok: true, message: `経営課題「${op.title}」を削除しました。`, flash: 'stage1.issues', undo: null };
    }
    case 'issue.edit': {
      const issues = (st.stage1Issues ?? []) as Array<{ title?: string } & Record<string, unknown>>;
      const idx = issues.findIndex((i) => i.title === op.title);
      if (idx < 0) return { ok: false, message: `経営課題「${op.title}」が見つかりません。反映しませんでした。` };
      if (op.field === 'title' && issues.some((i, j) => j !== idx && i.title === op.value)) {
        return { ok: false, message: '同じ題名の経営課題がすでにあるため、反映しませんでした。' };
      }
      const prev = issues[idx][op.field] as string | string[] | undefined;
      const next = issues.map((issue, i) => {
        if (i !== idx) return issue;
        const copy: Record<string, unknown> = { ...issue };
        if (op.value === null) delete copy[op.field];
        else copy[op.field] = op.value;
        return copy as typeof issue;
      });
      st.setStage1Issues(next as never);
      const what = op.field === 'title' ? '題名' : op.field === 'description' ? '説明文' : op.field === 'scope' ? '対象範囲' : '根拠となる指標';
      return {
        ok: true,
        message: `経営課題「${op.title}」の${what}を入力欄に反映しました。`,
        flash: `stage1.issue.${idx}`,
        undo: {
          kind: 'issue.edit',
          title: op.field === 'title' && typeof op.value === 'string' ? op.value : op.title,
          field: op.field,
          value: prev ?? null,
        },
      };
    }
    case 'profile': {
      const prev = (st as unknown as Record<string, unknown>)[op.field];
      st.setProfile({ [op.field]: op.value } as never);
      return {
        ok: true,
        message: `${PROFILE_LABEL[op.field]}を「${op.display}」として入力欄に反映しました。`,
        flash: `stage1.profile.${op.field}`,
        undo: { kind: 'profile', field: op.field, value: typeof prev === 'string' ? prev : '', display: typeof prev === 'string' ? prev : '' },
      };
    }
    case 'segment.add': {
      const segs = st.businessSegments ?? [];
      if (segs.length >= 10) return { ok: false, message: '事業は10件までのため、反映しませんでした。' };
      if (segs.some((s) => s.name === op.name)) return { ok: false, message: `「${op.name}」という事業はすでにあります。` };
      const id = newSegmentId();
      st.setProfile({ businessSegments: [...segs, { id, name: op.name }] } as never);
      return {
        ok: true,
        message: `事業「${op.name}」を追加し、入力欄に反映しました。`,
        flash: `stage1.segment.${segs.length}`,
        undo: { kind: 'segment.remove', id, name: op.name },
      };
    }
    case 'segment.remove': {
      const check = removalCheck(op, st);
      if (!check.ok) return { ok: false, message: check.reason };
      const nextSegments = (st.businessSegments ?? []).filter((s) => s.id !== op.id);
      st.setProfile({ businessSegments: nextSegments } as never);
      // 自動生成の事業ポートフォリオは、残った事業から同じ生成処理で作り直す（既存の値は残す）
      if (st.businessPortfolio) {
        const portfolio = buildBusinessPortfolio({
          segments: nextSegments,
          segmentValueAnalysis: (st as unknown as { segmentValueAnalysis?: Record<string, ValueAnalysis> }).segmentValueAnalysis,
          segmentPL: st.segmentPL as Record<string, FinancePLRow[]> | undefined,
          fallback: st.businessPortfolio,
        });
        st.setProfile({ businessPortfolio: portfolio ?? undefined } as never);
      }
      return { ok: true, message: `事業「${op.name}」を削除しました。`, flash: 'stage1.segments', undo: null };
    }
    case 'segment.rename': {
      const segs = st.businessSegments ?? [];
      const idx = segs.findIndex((s) => s.name === op.from);
      if (idx < 0) return { ok: false, message: `事業「${op.from}」が見つかりません。反映しませんでした。` };
      if (segs.some((s, i) => i !== idx && s.name === op.to)) return { ok: false, message: `「${op.to}」という事業はすでにあります。` };
      st.setProfile({ businessSegments: segs.map((s, i) => (i === idx ? { ...s, name: op.to } : s)) } as never);
      return {
        ok: true,
        message: `事業名を「${op.from}」から「${op.to}」に変更し、入力欄に反映しました。`,
        flash: `stage1.segment.${idx}`,
        undo: { kind: 'segment.rename', from: op.to, to: op.from },
      };
    }
    case 'segment.set': {
      const segs = st.businessSegments ?? [];
      const idx = segs.findIndex((s) => s.name === op.name);
      if (idx < 0) return { ok: false, message: `事業「${op.name}」が見つかりません。反映しませんでした。` };
      const field = op.field;
      const prev = (segs[idx] as unknown as Record<string, unknown>)[field] as string | string[] | undefined;
      const next = segs.map((s, i) => {
        if (i !== idx) return s;
        const copy: Record<string, unknown> = { ...s };
        if (op.value === null) delete copy[field];
        else copy[field] = op.value;
        return copy as typeof s;
      });
      st.setProfile({ businessSegments: next } as never);
      return {
        ok: true,
        message: `「${op.name}」の${field === 'keyCustomers' ? '主な顧客' : field === 'summary' ? '事業概要' : '展開地域'}を入力欄に反映しました。`,
        flash: `stage1.segment.${idx}`,
        undo: { kind: 'segment.set', name: op.name, field, value: prev ?? null },
      };
    }
    case 'finance':
      return writeFinance(op);
    case 'wacc': {
      const bm = { ...((st.stage1Benchmarks ?? {}) as object) } as { waccManual?: number };
      const prev = bm.waccManual ?? null;
      if (op.pct === null) delete bm.waccManual;
      else bm.waccManual = op.pct;
      st.setStage1Benchmarks(bm as never);
      return {
        ok: true,
        message: op.pct === null ? 'WACCを空欄に戻しました。' : `WACCを${op.pct}%として入力欄に反映しました。`,
        flash: 'stage1.assumption.wacc',
        undo: { kind: 'wacc', pct: prev },
      };
    }
    case 'valuation': {
      st.recomputeValueAnalysis();
      // 他のSTAGEから頼まれた場合も、STAGE1の「分析・論点」タブの財務指標を示す
      return {
        ok: true,
        message: '企業価値分析を更新しました。結果は「分析・論点」タブの「財務指標」に表示されます。',
        flash: 'stage1.valuation',
        undo: null,
      };
    }
  }
}

/** 反映直後の取り消し情報。自動保存を待つ前に記録する（待機中に変わったら、後で取り消さない） */
function recordAfterWrite(op: StageOp, written: { undo: StageOp | null; message: string }, userId: string): AiWriteRecord | null {
  const now = useStrategyStore.getState();
  if (!written.undo || !now.companyId || !now.strategyId) {
    useAiUndoStore.getState().clear();
    return null;
  }
  const record: AiWriteRecord = {
    companyId: now.companyId,
    strategyId: now.strategyId,
    userId,
    op,
    undo: written.undo,
    afterSignature: valueSignatureOf(op, now),
    label: written.message,
  };
  useAiUndoStore.getState().record(record);
  return record;
}

/** 自動保存の待機の後も、記録した時の利用者・企業・戦略・対象値のままか */
function isRecordStillValid(record: AiWriteRecord): boolean {
  const now = useStrategyStore.getState();
  return (
    now.companyId === record.companyId &&
    now.strategyId === record.strategyId &&
    useUserStore.getState().user?.id === record.userId &&
    valueSignatureOf(record.op, now) === record.afterSignature
  );
}

/** 入力操作を、画面の入力欄（ストア）へ反映する。権限・企業/戦略・他の利用者による更新・対象の値を確かめてから書く */
export async function applyStageOp(op: StageOp, options: ApplyOptions = {}): Promise<DirectApplyResult> {
  try {
    if (!roleMeetsRequirement(useUserStore.getState().role ?? null, 'manager')) {
      return { ok: false, message: OPERATION_ROLE_DENIED };
    }
    const before = useStrategyStore.getState();
    const userId = useUserStore.getState().user?.id ?? null;
    if (!before.companyId || !before.strategyId || !userId) return { ok: false, message: SCOPE_CHANGED };
    const valueBefore = valueSignatureOf(op, before);

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
    const sameScope =
      after.companyId === before.companyId &&
      after.strategyId === before.strategyId &&
      data.session?.user?.id === userId &&
      useUserStore.getState().user?.id === userId;
    if (!sameScope) return { ok: false, message: SCOPE_CHANGED };
    if (!roleMeetsRequirement(useUserStore.getState().role ?? null, 'manager')) {
      return { ok: false, message: OPERATION_ROLE_DENIED };
    }
    if (typeof revision !== 'number' || after.revision !== revision) return { ok: false, message: REVISION_CHANGED };
    if (valueSignatureOf(op, after) !== valueBefore) return { ok: false, message: VALUE_CHANGED };

    const written = writeOp(op);
    if (!written.ok) return written;
    if (written.flash) useAiHighlightStore.getState().flash(written.flash);

    // 取り消し情報は、自動保存を待つ前（反映直後）の利用者・企業・戦略・対象値で記録する
    const record = options.recordUndo !== false ? recordAfterWrite(op, written, userId) : null;

    const status =
      options.settleMs === 0 ? saveStatusTypeOf(useStrategyStore.getState()) : await waitForSaveSettled(options.settleMs);

    // 待機中に変わっていれば、その取り消し情報は登録しない
    if (record && !isRecordStillValid(record)) useAiUndoStore.getState().clear();
    return { ok: true, message: `${written.message}${saveSentenceOf(status)}` };
  } catch {
    return { ok: false, message: '反映の途中で問題が起きました。画面を再読み込みして、内容を確かめてください。' };
  }
}

/** 経営課題の追加・売上の空欄への入力などの入力案を、入力欄へ直接反映する */
export async function applyDirectProposal(proposal: OperationProposal, options: ApplyOptions = {}): Promise<DirectApplyResult> {
  if (!isDirectProposal(proposal)) return { ok: false, message: 'この操作は、入力欄への直接反映の対象ではありません。' };
  const st = useStrategyStore.getState();
  if (st.companyId !== proposal.companyId || st.strategyId !== proposal.strategyId) return { ok: false, message: SCOPE_CHANGED };
  const stale = proposalStaleReason(proposal, currentFor(proposal));
  if (stale) return { ok: false, message: stale.message };
  return applyStageOp(opOfDirectProposal(proposal), options);
}

/** 直前のAI入力を取り消せるかを確かめる。利用者・企業・戦略が同じで、対象の値が反映時のままの場合だけ */
export function planUndo(): { ok: true; record: AiWriteRecord } | { ok: false; message: string } {
  const record = useAiUndoStore.getState().last;
  if (!record) return { ok: false, message: '取り消せる直前の入力はありません。' };
  const st = useStrategyStore.getState();
  if (useUserStore.getState().user?.id !== record.userId) {
    return { ok: false, message: '利用者が変わったため、取り消せません。' };
  }
  if (st.companyId !== record.companyId || st.strategyId !== record.strategyId) {
    return { ok: false, message: '企業または戦略が変わったため、取り消せません。' };
  }
  if (valueSignatureOf(record.op, st) !== record.afterSignature) {
    return { ok: false, message: 'その後に同じ項目が変わったため、取り消せません。画面で内容を確かめてください。' };
  }
  return { ok: true, record };
}

/** 登録済みの事業・経営課題の削除の案を作る。下流との紐づけを安全に確認できないものは案にしない（承認時にも同じ判定をかける） */
export function planRemoval(target: RemovalTarget): { ok: true; op: RemovalOp; impact: string } | { ok: false; message: string } {
  const st = useStrategyStore.getState();
  if (target.type === 'segment') {
    const seg = (st.businessSegments ?? []).find((s) => s.name === target.name);
    if (!seg) return { ok: false, message: `事業「${target.name}」が見つかりません。` };
    const op: RemovalOp = { kind: 'segment.remove', id: seg.id, name: target.name };
    const check = removalCheck(op, st);
    if (!check.ok) return { ok: false, message: check.reason };
    return {
      ok: true,
      op,
      impact: `事業「${target.name}」の事業概要・主な顧客・展開地域を削除します。事業別の財務・経営課題・部門・企業の目標・プロジェクトとの紐づけを確認し、紐づきはありません。${
        st.businessPortfolio ? '自動生成の事業ポートフォリオからも、この事業を外して作り直します。' : ''
      }`,
    };
  }
  const op: RemovalOp = { kind: 'issue.remove', title: target.name };
  const check = removalCheck(op, st);
  if (!check.ok) return { ok: false, message: check.reason };
  const count = (st.stage1Issues ?? []).length;
  return {
    ok: true,
    op,
    impact: `経営課題「${target.name}」を削除します。企業の目標・プロジェクトとの紐づけを確認し、紐づきはありません。${
      count === 1 ? '経営課題が0件になるため、STAGE2へは進めなくなります。' : ''
    }`,
  };
}
