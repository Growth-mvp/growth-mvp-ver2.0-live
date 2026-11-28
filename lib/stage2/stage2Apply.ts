// STAGE2の入力操作を、既存のストア更新関数で入力欄へ直接反映する。保存はしない（画面の保存と同じ仕様）。
// 権限は画面と同じく管理者。サーバーの認可（stage2.input / stage2.ceoIntent）と、書き込みの前後の確認を使う。
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { runGuardedWrite, type WriteOutcome } from '@/lib/aiOperations/guardedWrite';
import { saveSentenceOf, waitForSaveSettled } from '@/lib/aiOperations/saveSettle';
import { saveStatusTypeOf } from '@/lib/strategy/saveStatus';
import type { CompanyTarget } from '@/types/strategy';
import type { Stage2Op } from './stage2Input';

type Result = { ok: true; message: string } | { ok: false; message: string };

function appendLine(current: string | undefined, text: string): string {
  const cur = (current ?? '').replace(/\s+$/, '');
  return cur ? `${cur}\n${text}` : text;
}

/** 入力対象の全体の値。確認の前後で比べ、同じ項目が変わっていれば書き込まない */
export function stage2SignatureOf(op: Stage2Op, st: StrategyState): string {
  const s = st as unknown as Record<string, unknown>;
  switch (op.kind) {
    case 'ceo.append':
      return JSON.stringify(st.ceoIntent ?? '');
    case 'mvv.set':
      return JSON.stringify(s[op.field] ?? '');
    case 'target.add':
      return JSON.stringify((st.companyTargets ?? []).map((t) => [t.id, t.label, t.dueYear ?? null]));
    case 'target.setBase':
      return JSON.stringify((st.companyTargets ?? []).find((t) => t.id === op.id) ?? null);
    case 'swot.add':
      return JSON.stringify(s[op.field] ?? '');
    case 'answer.set':
      return JSON.stringify((st.answers12 ?? []).find((a) => a.id === op.questionId) ?? null);
  }
}

function writeStage2(op: Stage2Op): WriteOutcome {
  const st = useStrategyStore.getState();
  switch (op.kind) {
    case 'ceo.append': {
      st.setCeoIntent(appendLine(st.ceoIntent, op.text));
      return { ok: true, message: '経営者の思いに追記しました。', flash: 'stage2.ceoIntent', undo: null };
    }
    case 'mvv.set': {
      st.setMVV({ [op.field]: op.value } as never);
      const label = { mission: 'ミッション', vision: 'ビジョン', value: 'バリュー' }[op.field];
      return { ok: true, message: `${label}を入力欄に反映しました。`, flash: 'stage2.mvv', undo: null };
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
        undo: null,
      };
    }
    case 'target.setBase': {
      const current = (st.companyTargets ?? []).find((t) => t.id === op.id);
      if (!current) return { ok: false, message: `「${op.label}」の目標が見つかりません。反映しませんでした。` };
      if (current.unit !== op.unit) return { ok: false, message: `「${op.label}」の単位は「${current.unit}」です。反映しませんでした。` };
      st.updateCompanyTarget(op.id, { base: op.base });
      return {
        ok: true,
        message: `「${op.label}」の目標値を${op.base.toLocaleString('ja-JP')}${op.unit}に変更しました。`,
        flash: `stage2.target.${op.id}`,
        undo: null,
      };
    }
    case 'swot.add': {
      const current = (st as unknown as Record<string, string | undefined>)[op.field];
      st.setSWOT({ [op.field]: appendLine(current, op.text) } as never);
      const label = { strength: '強み', weakness: '弱み', opportunity: '機会', threat: '脅威' }[op.field];
      return { ok: true, message: `${label}に追加しました。`, flash: `stage2.swot.${op.field}`, undo: null };
    }
    case 'answer.set': {
      if (!(st.answers12 ?? []).some((a) => a.id === op.questionId)) {
        return { ok: false, message: '回答欄が見つからないため、反映しませんでした。画面を再読み込みしてください。' };
      }
      st.updateAnswer12(op.questionId, { answer: op.text });
      return { ok: true, message: '回答を入力欄に反映しました。', flash: `stage2.question.${op.questionId}`, undo: null };
    }
  }
}

/** 管理者の権限で、STAGE2の入力操作を入力欄へ反映する（経営者の思いは、サーバーでも管理者に限る） */
export async function applyStage2Op(op: Stage2Op, options: { settleMs?: number } = {}): Promise<Result> {
  try {
    const guarded = await runGuardedWrite({
      minRole: 'admin',
      operation: op.kind === 'ceo.append' ? 'stage2.ceoIntent' : 'stage2.input',
      signature: (st) => stage2SignatureOf(op, st),
      write: () => writeStage2(op),
    });
    if (!guarded.ok) return guarded;
    if (guarded.flash) useAiHighlightStore.getState().flash(guarded.flash);
    const status =
      options.settleMs === 0 ? saveStatusTypeOf(useStrategyStore.getState()) : await waitForSaveSettled(options.settleMs);
    return { ok: true, message: `${guarded.message}${saveSentenceOf(status)}` };
  } catch {
    return { ok: false, message: '反映の途中で問題が起きました。画面を再読み込みして、内容を確かめてください。' };
  }
}
