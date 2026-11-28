// STAGE2の入力操作を、既存のストア更新関数で入力欄へ直接反映する。保存はしない（画面の保存と同じ仕様）。
// 権限は画面と同じく管理者。書き込みの前後の確認（利用者・企業・戦略・版・対象値）は共通の処理を使う。
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { useUserStore } from '@/store/userStore';
import { runGuardedWrite, type WriteOutcome } from '@/lib/aiOperations/guardedWrite';
import { useAiUndoStore, type AiWriteRecord } from '@/lib/aiOperations/aiUndoStore';
import { saveSentenceOf, waitForSaveSettled } from '@/lib/aiOperations/saveSettle';
import { saveStatusTypeOf } from '@/lib/strategy/saveStatus';
import type { CompanyTarget } from '@/types/strategy';
import type { Stage2Op, SwotField } from './stage2Input';

export type Stage2ApplyResult = { ok: true; message: string } | { ok: false; message: string };

const STAGE2_KINDS = new Set<string>([
  'ceo.append',
  'ceo.set',
  'mvv.set',
  'target.add',
  'target.setBase',
  'target.update',
  'target.remove',
  'swot.add',
  'swot.replace',
  'swot.remove',
  'answer.set',
]);

/** 記録された操作がSTAGE2のものか（取り消しの照合と実行の振り分けに使う） */
export function isStage2Op(op: { kind: string }): op is Stage2Op {
  return STAGE2_KINDS.has(op.kind);
}

const SWOT_LABEL: Record<SwotField, string> = { strength: '強み', weakness: '弱み', opportunity: '機会', threat: '脅威' };

function appendLine(current: string | undefined, text: string): string {
  const cur = (current ?? '').replace(/\s+$/, '');
  return cur ? `${cur}\n${text}` : text;
}

function swotLinesOf(value: string | undefined): string[] {
  return (value ?? '').split('\n');
}

/** 入力対象の全体の値。確認の前後で比べ、同じ項目が変わっていれば書き込まない */
export function stage2SignatureOf(op: Stage2Op, st: StrategyState): string {
  const s = st as unknown as Record<string, unknown>;
  switch (op.kind) {
    case 'ceo.append':
    case 'ceo.set':
      return JSON.stringify(st.ceoIntent ?? '');
    case 'mvv.set':
      return JSON.stringify(s[op.field] ?? '');
    case 'target.add':
      return JSON.stringify((st.companyTargets ?? []).map((t) => [t.id, t.label, t.dueYear ?? null]));
    case 'target.setBase':
    case 'target.update':
    case 'target.remove':
      return JSON.stringify((st.companyTargets ?? []).find((t) => t.id === op.id) ?? null);
    case 'swot.add':
    case 'swot.replace':
    case 'swot.remove':
      return JSON.stringify(s[op.field] ?? '');
    case 'answer.set':
      return JSON.stringify((st.answers12 ?? []).find((a) => a.id === op.questionId) ?? null);
  }
}

function writeStage2(op: Stage2Op): WriteOutcome {
  const st = useStrategyStore.getState();
  switch (op.kind) {
    case 'ceo.append':
    case 'ceo.set': {
      const prev = st.ceoIntent ?? '';
      st.setCeoIntent(op.kind === 'ceo.append' ? appendLine(prev, op.text) : op.text);
      return {
        ok: true,
        message: op.kind === 'ceo.append' ? '経営者の思いに追記しました。' : '経営者の思いを修正しました。',
        flash: 'stage2.ceoIntent',
        undo: { kind: 'ceo.set', text: prev },
      };
    }
    case 'mvv.set': {
      const prev = ((st as unknown as Record<string, string | undefined>)[op.field]) ?? '';
      st.setMVV({ [op.field]: op.value } as never);
      const label = { mission: 'ミッション', vision: 'ビジョン', value: 'バリュー' }[op.field];
      return { ok: true, message: `${label}を入力欄に反映しました。`, flash: 'stage2.mvv', undo: { kind: 'mvv.set', field: op.field, value: prev } };
    }
    case 'target.add': {
      const targets = st.companyTargets ?? [];
      if (targets.some((t) => t.label === op.label && (t.dueYear ?? null) === (op.dueYear ?? null))) {
        return { ok: false, message: `「${op.label}」の目標はすでにあります。値を変える場合は、同じ名前で目標値を指示してください。` };
      }
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `target_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const target = {
        id,
        label: op.label,
        unit: op.unit,
        base: op.base,
        ...(op.dueYear ? { dueYear: op.dueYear } : {}),
        priority: 3,
        rationale: '',
        linkedIssueIds: [],
      } as unknown as CompanyTarget;
      st.addCompanyTarget(target);
      const year = op.dueYear ? `${op.dueYear}年度の` : '';
      return {
        ok: true,
        message: `${year}${op.label}の目標を${op.base.toLocaleString('ja-JP')}${op.unit}として入力欄に追加しました。`,
        flash: `stage2.target.${id}`,
        undo: { kind: 'target.remove', id, label: op.label },
      };
    }
    case 'target.setBase': {
      const current = (st.companyTargets ?? []).find((t) => t.id === op.id);
      if (!current) return { ok: false, message: `「${op.label}」の目標が見つかりません。反映しませんでした。` };
      if (current.unit !== op.unit) return { ok: false, message: `「${op.label}」の単位は「${current.unit}」です。反映しませんでした。` };
      const prevBase = current.base;
      st.updateCompanyTarget(op.id, { base: op.base });
      return {
        ok: true,
        message: `「${op.label}」の目標値を${op.base.toLocaleString('ja-JP')}${op.unit}に変更しました。`,
        flash: `stage2.target.${op.id}`,
        undo: { kind: 'target.setBase', id: op.id, label: op.label, unit: op.unit, base: prevBase },
      };
    }
    case 'target.update': {
      const current = (st.companyTargets ?? []).find((t) => t.id === op.id);
      if (!current) return { ok: false, message: `「${op.label}」の目標が見つかりません。反映しませんでした。` };
      const prevYear = current.dueYear;
      st.updateCompanyTarget(op.id, { dueYear: op.dueYear });
      return {
        ok: true,
        message: `「${op.label}」の年度を${op.dueYear}年度に変更しました。`,
        flash: `stage2.target.${op.id}`,
        undo: { kind: 'target.update', id: op.id, label: op.label, dueYear: prevYear },
      };
    }
    case 'target.remove': {
      const current = (st.companyTargets ?? []).find((t) => t.id === op.id);
      if (!current) return { ok: false, message: `「${op.label}」の目標が見つかりません。反映しませんでした。` };
      st.removeCompanyTarget(op.id);
      return { ok: true, message: `「${op.label}」の目標を削除しました。`, flash: 'stage2.targets', undo: null };
    }
    case 'swot.add': {
      const prev = (st as unknown as Record<string, string | undefined>)[op.field];
      st.setSWOT({ [op.field]: appendLine(prev, op.text) } as never);
      return {
        ok: true,
        message: `${SWOT_LABEL[op.field]}に追加しました。`,
        flash: `stage2.swot.${op.field}`,
        undo: { kind: 'swot.remove', field: op.field, text: op.text },
      };
    }
    case 'swot.replace': {
      const prev = (st as unknown as Record<string, string | undefined>)[op.field];
      const lines = swotLinesOf(prev);
      const idx = lines.findIndex((l) => l.trim() === op.from);
      if (idx < 0) return { ok: false, message: `${SWOT_LABEL[op.field]}に「${op.from}」が見つかりません。反映しませんでした。` };
      lines[idx] = op.to;
      st.setSWOT({ [op.field]: lines.join('\n') } as never);
      return {
        ok: true,
        message: `${SWOT_LABEL[op.field]}の項目を修正しました。`,
        flash: `stage2.swot.${op.field}`,
        undo: { kind: 'swot.replace', field: op.field, from: op.to, to: op.from },
      };
    }
    case 'swot.remove': {
      const prev = (st as unknown as Record<string, string | undefined>)[op.field];
      const lines = swotLinesOf(prev);
      const idx = lines.findIndex((l) => l.trim() === op.text);
      if (idx < 0) return { ok: false, message: `${SWOT_LABEL[op.field]}に「${op.text}」が見つかりません。反映しませんでした。` };
      lines.splice(idx, 1);
      st.setSWOT({ [op.field]: lines.join('\n') } as never);
      return {
        ok: true,
        message: `${SWOT_LABEL[op.field]}から項目を削除しました。`,
        flash: `stage2.swot.${op.field}`,
        undo: { kind: 'swot.add', field: op.field, text: op.text },
      };
    }
    case 'answer.set': {
      const current = (st.answers12 ?? []).find((a) => a.id === op.questionId);
      if (!current) return { ok: false, message: '回答欄が見つからないため、反映しませんでした。画面を再読み込みしてください。' };
      const prev = current.answer ?? '';
      st.updateAnswer12(op.questionId, { answer: op.text });
      return {
        ok: true,
        message: '回答を入力欄に反映しました。',
        flash: `stage2.question.${op.questionId}`,
        undo: { kind: 'answer.set', questionId: op.questionId, text: prev },
      };
    }
  }
}

function recordStage2(op: Stage2Op, undo: Stage2Op, userId: string, label: string): AiWriteRecord | null {
  const now = useStrategyStore.getState();
  if (!now.companyId || !now.strategyId) {
    useAiUndoStore.getState().clear();
    return null;
  }
  const record: AiWriteRecord = {
    companyId: now.companyId,
    strategyId: now.strategyId,
    userId,
    op,
    undo,
    afterSignature: stage2SignatureOf(op, now),
    label,
  };
  useAiUndoStore.getState().record(record);
  return record;
}

/** 管理者の権限で、STAGE2の入力操作を入力欄へ反映する（経営者の思いは、サーバーでも管理者に限る） */
export async function applyStage2Op(op: Stage2Op, options: { settleMs?: number; recordUndo?: boolean } = {}): Promise<Stage2ApplyResult> {
  try {
    const guarded = await runGuardedWrite({
      minRole: 'admin',
      operation: op.kind.startsWith('ceo.') ? 'stage2.ceoIntent' : 'stage2.input',
      signature: (st) => stage2SignatureOf(op, st),
      write: () => writeStage2(op),
    });
    if (!guarded.ok) return guarded;
    if (guarded.flash) useAiHighlightStore.getState().flash(guarded.flash);

    const undo = guarded.undo as Stage2Op | null;
    const record =
      options.recordUndo !== false && undo ? recordStage2(op, undo, guarded.userId, guarded.message) : null;
    if (options.recordUndo !== false && !undo) useAiUndoStore.getState().clear();

    const status =
      options.settleMs === 0 ? saveStatusTypeOf(useStrategyStore.getState()) : await waitForSaveSettled(options.settleMs);
    // 待機中に変わっていれば、その取り消し情報は登録しない
    if (record && !isStage2RecordValid(record)) useAiUndoStore.getState().clear();
    return { ok: true, message: `${guarded.message}${saveSentenceOf(status)}` };
  } catch {
    return { ok: false, message: '反映の途中で問題が起きました。画面を再読み込みして、内容を確かめてください。' };
  }
}

function isStage2RecordValid(record: AiWriteRecord): boolean {
  const now = useStrategyStore.getState();
  return (
    now.companyId === record.companyId &&
    now.strategyId === record.strategyId &&
    useUserStore.getState().user?.id === record.userId &&
    stage2SignatureOf(record.op as Stage2Op, now) === record.afterSignature
  );
}
