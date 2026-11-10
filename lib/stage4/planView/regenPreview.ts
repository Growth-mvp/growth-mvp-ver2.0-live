/* 再生成のプレビューを、現在の計画書と項目ごとに比べる。保存はしない。
 * 反映するのは、利用者が手動で修正していない項目だけ（修正は上書きせず、履歴にも修正前の値は残らないため）。
 * 責任者（利用者が決める）と、STAGE3の確定KPIは、AIの案では反映しない。 */
import { listEditableItems, type EditableItem } from './regen';

type Json = Record<string, unknown>;
export type PreviewEdits = Record<string, string | number | boolean | null>;

export type PreviewRowStatus = 'SAME' | 'AVAILABLE' | 'MANUAL' | 'EXCLUDED' | 'NOT_IN_CURRENT' | 'NOT_IN_NEW';

export type PreviewRow = {
  itemId: string;
  label: string;
  currentValue: unknown;
  newValue: unknown;
  status: PreviewRowStatus;
  reason: string | null;
};

/* 保存された草案（ai_draft）から、編集の対象になる元の案を取り出す（修正の記録と同じ経路） */
export function draftOfBundle(bundle: Json): Json | null {
  if (typeof bundle.rawOutput === 'string') {
    try {
      return JSON.parse(bundle.rawOutput) as Json;
    } catch {
      return null;
    }
  }
  return (bundle.plan as Json) ?? null;
}

const EXCLUDED_REASON: Record<string, string> = {
  responsible: '責任者は利用者が決めるため、AIの案では反映しない',
};

function exclusionOf(itemId: string): string | null {
  if (EXCLUDED_REASON[itemId]) return EXCLUDED_REASON[itemId];
  if (/^kpi:S\d+:/.test(itemId)) return 'STAGE3で確定したKPIのため、AIの案では反映しない';
  return null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function comparePreview(args: { currentBundle: Json; committed: PreviewEdits; newBundle: Json }): PreviewRow[] {
  const currentDraft = draftOfBundle(args.currentBundle);
  const newDraft = draftOfBundle(args.newBundle);
  if (!currentDraft || !newDraft) return [];
  const current: EditableItem[] = listEditableItems(currentDraft);
  const next: EditableItem[] = listEditableItems(newDraft);
  const nextById = new Map(next.map((i) => [i.itemId, i]));
  const currentIds = new Set(current.map((i) => i.itemId));

  const rows: PreviewRow[] = current.map((item) => {
    const hasManual = Object.prototype.hasOwnProperty.call(args.committed, item.itemId);
    const currentValue = hasManual ? args.committed[item.itemId] : item.value;
    const found = nextById.get(item.itemId);
    const excluded = exclusionOf(item.itemId);
    if (!found) {
      return { itemId: item.itemId, label: item.label, currentValue, newValue: null, status: 'NOT_IN_NEW', reason: '新しい案には、この項目がない' };
    }
    if (same(currentValue, found.value)) {
      return { itemId: item.itemId, label: item.label, currentValue, newValue: found.value, status: 'SAME', reason: null };
    }
    if (excluded) {
      return { itemId: item.itemId, label: item.label, currentValue, newValue: found.value, status: 'EXCLUDED', reason: excluded };
    }
    if (hasManual) {
      return {
        itemId: item.itemId,
        label: item.label,
        currentValue,
        newValue: found.value,
        status: 'MANUAL',
        reason: '利用者が修正した内容があるため、上書きしない',
      };
    }
    return { itemId: item.itemId, label: item.label, currentValue, newValue: found.value, status: 'AVAILABLE', reason: null };
  });

  for (const item of next) {
    if (currentIds.has(item.itemId)) continue;
    rows.push({ itemId: item.itemId, label: item.label, currentValue: null, newValue: item.value, status: 'NOT_IN_CURRENT', reason: '現在の計画書には、この項目がない' });
  }
  return rows;
}

/* 選んだ項目（反映できるものだけ）を、保存する修正に加える。他の修正と項目は変えない */
export function applyPreview(committed: PreviewEdits, rows: PreviewRow[], selectedIds: string[]): PreviewEdits {
  const allowed = new Set(rows.filter((r) => r.status === 'AVAILABLE').map((r) => r.itemId));
  const next: PreviewEdits = { ...committed };
  for (const id of selectedIds) {
    if (!allowed.has(id)) continue;
    const row = rows.find((r) => r.itemId === id);
    const value = row?.newValue;
    if (value === undefined) continue;
    next[id] = value as string | number | boolean | null;
  }
  return next;
}
