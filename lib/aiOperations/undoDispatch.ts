// 直前のAI入力の取り消しを、記録された操作の種類（STAGE1かSTAGE2か）に応じて実行する。
// 取り消しは、対象の値の照合（planUndo）を済ませた記録に対してだけ呼ぶ。
import { applyStage2Op, isStage2Op } from '@/lib/stage2/stage2Apply';
import type { Stage2Op } from '@/lib/stage2/stage2Input';
import type { AiWriteRecord } from './aiUndoStore';
import { applyStageOp } from './applyDirect';
import type { StageOp } from './stage1Input';

export async function applyUndoRecord(
  record: AiWriteRecord,
  options: { settleMs?: number } = {},
): Promise<{ ok: boolean; message: string }> {
  const undo = record.undo;
  if (isStage2Op(undo)) return applyStage2Op(undo as Stage2Op, { ...options, recordUndo: false });
  return applyStageOp(undo as StageOp, { ...options, recordUndo: false });
}
