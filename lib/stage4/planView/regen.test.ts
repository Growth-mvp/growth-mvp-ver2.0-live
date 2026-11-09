/* eslint-disable @typescript-eslint/no-explicit-any -- AI出力（JSON）の草案の形を直接たどる境界 */
import growth from './fixtures/growth.json';
import { applyAdopted, diffDrafts, hashValue, listEditableItems, reconcileEdits, type EditRecord } from './regen';

const draftOf = (): any => JSON.parse(JSON.stringify((growth as any).rawOutput ? JSON.parse((growth as any).rawOutput) : null));
const edit = (itemId: string, value: EditRecord['value'], baseFrom: unknown): EditRecord => ({
  itemId,
  value,
  baseHash: hashValue(baseFrom),
});

describe('AI草案と編集の分離', () => {
  it('草案の値の指紋は、同じ値なら同じ、違えば違う', () => {
    expect(hashValue('行動の内容')).toBe(hashValue('行動の内容'));
    expect(hashValue('行動の内容')).not.toBe(hashValue('行動の内容。'));
    expect(hashValue(null)).toBe(hashValue(null));
  });

  it('草案から、編集できる項目を安定ID（表示のキー）付きで列挙する', () => {
    const items = listEditableItems(draftOf());
    const ids = items.map((i) => i.itemId);
    expect(ids).toEqual(expect.arrayContaining(['goal', 'action:1:title', 'action:1:due', 'kpi:A1:target', 'risk:1:countermeasure', 'responsible']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('再生成と編集の保護', () => {
  it('草案が変わらなければ、編集はすべて保持される', () => {
    const d = draftOf();
    const edits = [edit('action:1:due', '2027-01', d.section2.actions[0].dueYm)];
    const r = reconcileEdits(edits, d, draftOf());
    expect(r.keep).toHaveLength(1);
    expect(r.conflict).toHaveLength(0);
    expect(r.orphaned).toHaveLength(0);
  });

  it('AI の値が変わった項目は、上書きせず競合として両方の値を示す', () => {
    const d = draftOf();
    const old = d.section2.actions[0].title;
    const edits = [edit('action:1:title', '利用者が書き直した行動', old)];
    const next = draftOf();
    next.section2.actions[0].title = 'AIが書き直した行動の内容（別の表現）';
    const r = reconcileEdits(edits, d, next);
    expect(r.keep).toHaveLength(0);
    expect(r.conflict).toHaveLength(1);
    expect(r.conflict[0].currentAiValue).toBe('AIが書き直した行動の内容（別の表現）');
    expect(r.conflict[0].edit.value).toBe('利用者が書き直した行動');
  });

  it('行動の番号が入れ替わっても、本文で同じ行動に対応づける（別の行動に当てない）', () => {
    const d = draftOf();
    const titleOf1 = d.section2.actions[0].title;
    const edits = [edit('action:1:title', '編集した行動1', titleOf1)];
    const next = draftOf();
    // 順番だけを入れ替える（本文は同じ）
    const a = next.section2.actions;
    [a[0], a[1]] = [a[1], a[0]];
    const r = reconcileEdits(edits, d, next);
    expect(r.keep).toHaveLength(1);
    expect(r.conflict).toHaveLength(0);
  });

  it('対応先が無くなった編集は、黙って消さず「対応なし」として残す', () => {
    const d = draftOf();
    const risk = d.section5.risks[0].countermeasure;
    const edits = [edit('risk:1:countermeasure', '利用者の対策案', risk)];
    const next = draftOf();
    next.section5.risks = [];
    const r = reconcileEdits(edits, d, next);
    expect(r.orphaned).toHaveLength(1);
    expect(r.orphaned[0].itemId).toBe('risk:1:countermeasure');
  });

  it('どの編集も、必ず keep・conflict・orphaned のどれか一つに入る（失われない）', () => {
    const d = draftOf();
    const edits = [
      edit('goal', 'A', d.section1.goalState.text),
      edit('action:1:due', '2027-01', d.section2.actions[0].dueYm),
      edit('risk:1:countermeasure', 'B', d.section5.risks[0].countermeasure),
    ];
    const next = draftOf();
    next.section1.goalState.text = '書き換えられた目指す状態';
    next.section5.risks = [];
    const r = reconcileEdits(edits, d, next);
    expect(r.keep.length + r.conflict.length + r.orphaned.length).toBe(edits.length);
  });
});

describe('差分表示と、採用した変更だけの反映', () => {
  it('再生成で変わった項目を、変更・追加・削除として示す', () => {
    const d = draftOf();
    const next = draftOf();
    next.section1.goalState.text = '書き換えられた目指す状態';
    next.section5.risks = [];
    const diffs = diffDrafts(d, next);
    expect(diffs.find((x) => x.itemId === 'goal')?.change).toBe('CHANGED');
    expect(diffs.find((x) => x.itemId === 'risk:1:countermeasure')?.change).toBe('REMOVED');
  });

  it('採用された変更だけを反映し、採用されなかった編集は含めない', () => {
    const d = draftOf();
    const edits = [
      edit('goal', 'A', d.section1.goalState.text),
      edit('action:1:due', '2027-01', d.section2.actions[0].dueYm),
    ];
    expect(applyAdopted(edits, ['action:1:due'])).toEqual({ 'action:1:due': '2027-01' });
    expect(applyAdopted(edits, [])).toEqual({});
  });
});
