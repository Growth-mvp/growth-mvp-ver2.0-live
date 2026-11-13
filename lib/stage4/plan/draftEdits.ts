/* 再生成の案に、以前の利用者の修正を引き継ぐかどうかを決める（サーバーと画面で同じ規則を使う）。
 * 同じ項目（itemId）でも、項目名・AIの文・種類・値のいずれかが変わったものは、以前の修正を引き継がない（意味が変わっている可能性があるため）。
 * 引き継がない修正は黙って消さず、どの項目かと前の修正を利用者に示せるよう dropped で返す（操作の履歴にも残る）。 */
import { IMPACT_EDIT_PREFIX } from '../planView/impactEstimate';
import { hashValue, listEditableItems, type EditableItem } from '../planView/regen';
import type { UserEdits } from './mergeUserEdits';

/* 開始前の確認の記録（task:<id>）。判定条件ではなく利用者の確認結果なので、再生成でも残す */
const CHECK_EDIT_PREFIX = 'task:';
/* STAGE3由来KPIのSTAGE4上の修正（STAGE3の元データは変えない）。再生成でも保護する */
const STAGE3_KPI_EDIT_PREFIX = 'stage3kpi:';

export type DroppedEdit ={ key: string; label: string; before: unknown; reason: 'REMOVED' | 'CHANGED' };
export type ReplaceEdits = { kept: UserEdits; dropped: DroppedEdit[] };

const planOf = (bundle: Record<string, unknown>): unknown => {
  const b = bundle as { rawOutput?: unknown; plan?: unknown };
  return typeof b.rawOutput === 'string' ? JSON.parse(b.rawOutput) : b.plan;
};

function itemsOf(bundle: Record<string, unknown>): Map<string, EditableItem> {
  const plan = planOf(bundle);
  const map = new Map<string, EditableItem>();
  if (!plan) return map;
  for (const item of listEditableItems(plan)) map.set(item.itemId, item);
  return map;
}

const signatureOf = (item: EditableItem): string => hashValue({ label: item.label, text: item.text, kind: item.kind, value: item.value });

export function editsAfterReplace(edits: UserEdits, oldBundle: Record<string, unknown>, newBundle: Record<string, unknown>): ReplaceEdits {
  const before = itemsOf(oldBundle);
  const after = itemsOf(newBundle);
  const kept: UserEdits = {};
  const dropped: DroppedEdit[] = [];
  for (const [key, value] of Object.entries(edits)) {
    if (key === 'responsible' || key.startsWith(IMPACT_EDIT_PREFIX) || key.startsWith(CHECK_EDIT_PREFIX) || key.startsWith(STAGE3_KPI_EDIT_PREFIX)) {
      kept[key] = value;
      continue;
    }
    const prev = before.get(key);
    const next = after.get(key);
    if (!next) {
      dropped.push({ key, label: prev?.label ?? key, before: value, reason: 'REMOVED' });
    } else if (prev && signatureOf(prev) !== signatureOf(next)) {
      dropped.push({ key, label: next.label, before: value, reason: 'CHANGED' });
    } else {
      kept[key] = value;
    }
  }
  return { kept, dropped };
}
