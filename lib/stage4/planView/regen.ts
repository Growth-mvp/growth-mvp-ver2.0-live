/* eslint-disable @typescript-eslint/no-explicit-any -- AI出力（JSON）の草案の形を直接たどる境界 */
// 再生成時のユーザー編集の保護（データ構造と判定。今回は再生成APIに接続しない）。
// - AI草案（生成された計画）は読むだけで、編集は別の記録（EditRecord）として持つ。
// - 編集の安定ID＝表示のキー（例：goal、action:1:title、kpi:A1:target、risk:1:countermeasure、responsible）。
//   同じ草案の中では一意で、再生成後は本文の一致で対応づけ直す。
// - 再生成で AI 側の値が変わった編集は、上書きせず「競合」として両方を示す。
// - 対応先が見つからない編集は、黙って消さず「対応なし」として残す。

export type EditRecord = {
  itemId: string;
  baseHash: string;
  value: string | number | boolean | null;
};

export type EditableItem = {
  itemId: string;
  kind: 'claim' | 'action' | 'kpi' | 'risk' | 'responsible' | 'role';
  field: string;
  label: string;
  value: string | number | null;
  text: string;
  order?: number;
};

export type ReconcileResult = {
  keep: EditRecord[];
  conflict: Array<{ edit: EditRecord; currentAiValue: string | number | null; label: string }>;
  orphaned: EditRecord[];
};

/** 値の指紋（FNV-1a 32bit）。編集した時点の AI 値と比べるために使う */
export function hashValue(v: unknown): string {
  const s = JSON.stringify(v ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const CLAIM_KEYS: Array<[string, string]> = [
  ['goal', 'section1.goalState'],
  ['customerProblem', 'section1.customerProblem'],
  ['customerOutcome', 'section1.customerOutcome'],
  ['ourValue', 'section1.ourValue'],
  ['whyChosen', 'section1.whyChosen'],
  ['problemCause', 'section1.problemCause'],
];

function bigramSet(text: string): Set<string> {
  const t = text.replace(/[\s、。・，．,.「」『』（）()：:]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function similarity(a: string, b: string): number {
  const x = bigramSet(a);
  const y = bigramSet(b);
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  const union = x.size + y.size - common;
  return union === 0 ? 0 : common / union;
}

/** AI草案の中で、利用者が編集できる項目と、その現在の値を列挙する（キーは表示と同じ） */
export function listEditableItems(draft: any): EditableItem[] {
  const items: EditableItem[] = [];
  for (const [key, path] of CLAIM_KEYS) {
    const claim = path.split('.').reduce((o: any, k: string) => o[k], draft);
    items.push({ itemId: key, kind: 'claim', field: 'text', label: path, value: claim.text, text: claim.text });
  }
  draft.section2.actions.forEach((a: any) => {
    items.push({ itemId: `action:${a.order}:title`, kind: 'action', field: 'title', label: `行動${a.order}`, value: a.title, text: a.title, order: a.order });
    items.push({ itemId: `action:${a.order}:due`, kind: 'action', field: 'dueYm', label: `行動${a.order}の期限`, value: a.dueYm, text: a.title, order: a.order });
    items.push({ itemId: `action:${a.order}:content`, kind: 'action', field: 'content', label: `行動${a.order}の主な内容`, value: a.mechanism?.stateChange ?? null, text: a.title, order: a.order });
    items.push({ itemId: `action:${a.order}:owner`, kind: 'action', field: 'owner', label: `行動${a.order}の担当`, value: a.ownerRole ?? null, text: a.title, order: a.order });
    items.push({ itemId: `action:${a.order}:deliverable`, kind: 'action', field: 'deliverable', label: `行動${a.order}の成果物`, value: a.deliverable ?? null, text: a.title, order: a.order });
    items.push({ itemId: `action:${a.order}:exit`, kind: 'action', field: 'exitCondition', label: `行動${a.order}の次に進める条件`, value: a.exitCondition ?? null, text: a.title, order: a.order });
    items.push({ itemId: `action:${a.order}:stage`, kind: 'action', field: 'valueStage', label: `行動${a.order}の収益化の段階`, value: a.valueStage ?? null, text: a.title, order: a.order });
  });
  ((draft.section5.roles ?? []) as any[]).forEach((r: any, i: number) => {
    items.push({ itemId: `role:${i + 1}:unit`, kind: 'role', field: 'unit', label: '担当部門', value: r.unit, text: r.unit });
    items.push({ itemId: `role:${i + 1}:role`, kind: 'role', field: 'role', label: r.unit, value: r.role, text: r.role });
  });
  draft.section3.kpis.forEach((k: any) => {
    items.push({ itemId: `kpi:${k.key}:target`, kind: 'kpi', field: 'target', label: k.label, value: k.target, text: k.label });
    items.push({ itemId: `kpi:${k.key}:due`, kind: 'kpi', field: 'due', label: k.label, value: k.due, text: k.label });
    items.push({ itemId: `kpi:${k.key}:owner`, kind: 'kpi', field: 'owner', label: k.label, value: k.owner, text: k.label });
  });
  draft.section5.risks.forEach((r: any, i: number) => {
    items.push({ itemId: `risk:${i + 1}:countermeasure`, kind: 'risk', field: 'countermeasure', label: r.risk, value: r.countermeasure, text: r.risk });
    items.push({ itemId: `risk:${i + 1}:risk`, kind: 'risk', field: 'risk', label: `リスク${i + 1}の内容`, value: r.risk, text: r.risk });
    items.push({ itemId: `risk:${i + 1}:confirmBy`, kind: 'risk', field: 'confirmBy', label: `リスク${i + 1}の確認時期`, value: r.confirmBy ?? null, text: r.risk });
  });
  items.push({ itemId: 'responsible', kind: 'responsible', field: 'name', label: '責任者', value: draft.section5.responsible.name, text: '責任者' });
  return items;
}

/** 編集の対応先を、新しい草案の中から探す。安定IDが同じならそれを、無ければ同じ種類の中で本文が最も近いものを使う */
function findTarget(edit: EditRecord, oldItem: EditableItem | undefined, newItems: EditableItem[]): EditableItem | null {
  const same = newItems.find((i) => i.itemId === edit.itemId);
  if (!oldItem) return same ?? null;
  // 同じ安定IDで、本文も近いものを優先する（番号が入れ替わった別の項目に当てない）
  if (same && same.kind === oldItem.kind && similarity(same.text, oldItem.text) >= 0.5) return same;
  let best: { item: EditableItem; score: number } | null = null;
  for (const item of newItems) {
    if (item.kind !== oldItem.kind || item.field !== oldItem.field) continue;
    const score = similarity(item.text, oldItem.text);
    if (score >= 0.5 && (!best || score > best.score)) best = { item, score };
  }
  if (best) return best.item;
  // 本文は大きく変わったが、同じ安定IDの項目は残っている（AI が書き直した）→ 競合として扱う
  return same && same.kind === oldItem.kind ? same : null;
}

/** 再生成後の草案に、既存の編集を当てる。上書きも削除もしない（結果は keep / conflict / orphaned の3つ） */
export function reconcileEdits(edits: EditRecord[], oldDraft: any, newDraft: any): ReconcileResult {
  const oldItems = listEditableItems(oldDraft);
  const newItems = listEditableItems(newDraft);
  const result: ReconcileResult = { keep: [], conflict: [], orphaned: [] };
  for (const edit of edits) {
    const oldItem = oldItems.find((i) => i.itemId === edit.itemId);
    const target = findTarget(edit, oldItem, newItems);
    if (!target) {
      result.orphaned.push(edit);
      continue;
    }
    if (hashValue(target.value) === edit.baseHash) {
      result.keep.push(edit);
    } else {
      result.conflict.push({ edit, currentAiValue: target.value, label: target.label });
    }
  }
  return result;
}

/** 草案の差分（再生成で、どの項目が変わったか）。対応づけは reconcileEdits と同じ規則 */
export function diffDrafts(oldDraft: any, newDraft: any): Array<{ itemId: string; change: 'CHANGED' | 'ADDED' | 'REMOVED'; before: unknown; after: unknown }> {
  const oldItems = listEditableItems(oldDraft);
  const newItems = listEditableItems(newDraft);
  const out: Array<{ itemId: string; change: 'CHANGED' | 'ADDED' | 'REMOVED'; before: unknown; after: unknown }> = [];
  for (const o of oldItems) {
    const n = newItems.find((i) => i.itemId === o.itemId);
    if (!n) out.push({ itemId: o.itemId, change: 'REMOVED', before: o.value, after: null });
    else if (hashValue(n.value) !== hashValue(o.value)) out.push({ itemId: o.itemId, change: 'CHANGED', before: o.value, after: n.value });
  }
  for (const n of newItems) {
    if (!oldItems.some((o) => o.itemId === n.itemId)) out.push({ itemId: n.itemId, change: 'ADDED', before: null, after: n.value });
  }
  return out;
}

/** 利用者が採用した変更だけを反映する。採用されなかった編集は、表示の上書きに使わない */
export function applyAdopted(edits: EditRecord[], adoptedItemIds: string[]): Record<string, EditRecord['value']> {
  const adopted = new Set(adoptedItemIds);
  const out: Record<string, EditRecord['value']> = {};
  for (const e of edits) if (adopted.has(e.itemId)) out[e.itemId] = e.value;
  return out;
}
