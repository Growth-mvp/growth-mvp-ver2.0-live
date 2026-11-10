import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { applyPreview, comparePreview, draftOfBundle, type PreviewRow } from './regenPreview';

const base = () => JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT)) as any;
const bundleOf = (d: unknown) => ({ rawOutput: JSON.stringify(d), plan: d });

function changedDraft() {
  const d = base();
  d.section2.actions[0].title = '新しい案の行動名';
  d.section2.actions[1].dueYm = '2027-12';
  d.section5.responsible.name = '別の担当者';
  d.section5.risks[0].countermeasure = '新しい対策';
  return d;
}

const rowOf = (rows: PreviewRow[], id: string) => rows.find((r) => r.itemId === id);

describe('再生成のプレビューと現在の計画書の比較', () => {
  it('同じ案なら、どの項目も変更なしで、反映するものは無い', () => {
    const rows = comparePreview({ currentBundle: bundleOf(base()), committed: {}, newBundle: bundleOf(base()) });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'SAME')).toBe(true);
  });

  it('変わった項目は、反映できる状態（AVAILABLE）として示す', () => {
    const rows = comparePreview({ currentBundle: bundleOf(base()), committed: {}, newBundle: bundleOf(changedDraft()) });
    expect(rowOf(rows, 'action:1:title')).toMatchObject({ status: 'AVAILABLE', newValue: '新しい案の行動名' });
    expect(rowOf(rows, 'action:2:due')).toMatchObject({ status: 'AVAILABLE', newValue: '2027-12' });
  });

  it('利用者が修正した項目は、新しい案があっても上書きしない（MANUAL）', () => {
    const rows = comparePreview({
      currentBundle: bundleOf(base()),
      committed: { 'action:1:title': '利用者が直した行動名' },
      newBundle: bundleOf(changedDraft()),
    });
    expect(rowOf(rows, 'action:1:title')).toMatchObject({ status: 'MANUAL', currentValue: '利用者が直した行動名' });
    const after = applyPreview({ 'action:1:title': '利用者が直した行動名' }, rows, ['action:1:title']);
    expect(after['action:1:title']).toBe('利用者が直した行動名');
  });

  it('責任者は、AIの案では反映しない（EXCLUDED）', () => {
    const rows = comparePreview({ currentBundle: bundleOf(base()), committed: {}, newBundle: bundleOf(changedDraft()) });
    expect(rowOf(rows, 'responsible')?.status).toBe('EXCLUDED');
    const after = applyPreview({}, rows, ['responsible']);
    expect(after).toEqual({});
  });

  it('新しい案にだけある項目は、現在の計画書へは追加しない（NOT_IN_CURRENT）', () => {
    const d = changedDraft();
    d.section2.actions.push({ ...d.section2.actions[0], order: 8, title: '追加された行動' });
    const rows = comparePreview({ currentBundle: bundleOf(base()), committed: {}, newBundle: bundleOf(d) });
    const added = rows.find((r) => r.status === 'NOT_IN_CURRENT' && r.label.includes('8'));
    expect(added).toBeDefined();
    const after = applyPreview({}, rows, [added!.itemId]);
    expect(after).toEqual({});
  });

  it('新しい案で無くなった項目は、現在の内容を残す（NOT_IN_NEW・反映しない）', () => {
    const d = changedDraft();
    d.section2.actions = d.section2.actions.slice(0, 2);
    const rows = comparePreview({ currentBundle: bundleOf(base()), committed: {}, newBundle: bundleOf(d) });
    expect(rows.some((r) => r.status === 'NOT_IN_NEW')).toBe(true);
    const removed = rows.find((r) => r.status === 'NOT_IN_NEW')!;
    expect(applyPreview({}, rows, [removed.itemId])).toEqual({});
  });

  it('反映は、選んだ変更可能な項目だけを加え、元の修正は変えない', () => {
    const rows = comparePreview({ currentBundle: bundleOf(base()), committed: { 'risk:1:countermeasure': '既存の修正' }, newBundle: bundleOf(changedDraft()) });
    const committed = { 'risk:1:countermeasure': '既存の修正' };
    const after = applyPreview(committed, rows, ['action:1:title', 'action:2:due']);
    expect(after).toEqual({ 'risk:1:countermeasure': '既存の修正', 'action:1:title': '新しい案の行動名', 'action:2:due': '2027-12' });
    expect(committed).toEqual({ 'risk:1:countermeasure': '既存の修正' });
  });

  it('保存された案の生のAI出力を優先して読む。読めなければ空を返す', () => {
    expect(draftOfBundle({ rawOutput: '{"a":1}', plan: { a: 2 } })).toEqual({ a: 1 });
    expect(draftOfBundle({ rawOutput: 'not json', plan: null })).toBeNull();
    expect(comparePreview({ currentBundle: { rawOutput: 'x' }, committed: {}, newBundle: bundleOf(base()) })).toEqual([]);
  });
});
