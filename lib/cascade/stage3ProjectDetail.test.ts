import { projectDetailOf } from './stage3ProjectDetail';

const official = [
  {
    id: 'proj-a',
    title: '既存の保守を強化',
    reason: '既存顧客の再発注を増やす',
    hypothesis: '点検の提案で稼働率が上がる',
    sourceType: 'existing',
    okrs: [{ objective: '再発注を増やす', keyResults: ['再発注率を20%にする'] }],
    kpis: ['再発注率'],
  },
  {
    id: 'proj-b',
    title: '工場間の連携',
    reason: '',
    hypothesis: '工場の在庫が見える',
    sourceType: 'interCollab',
    partnerDepartment: '生産',
  },
];

const candidates = [
  {
    id: 'proj-c',
    title: '新市場の探索',
    reason: '新しい顧客層へ広げる',
    hypothesis: '医療分野で需要がある',
    sourceType: 'new',
  },
];

describe('projectDetailOf（草案の詳細を正式データ・新規候補で補う）', () => {
  it('同じ id の正式データから、選定理由・仮説・目標・分類を取る', () => {
    const d = projectDetailOf({ id: 'proj-a', title: '既存の保守を強化', description: '要約' }, { official, candidates: [] });
    expect(d.group).toBe('existing');
    expect(d.purpose).toBe('既存顧客の再発注を増やす');
    expect(d.hypothesis).toBe('点検の提案で稼働率が上がる');
    expect(d.okrs).toEqual([{ objective: '再発注を増やす', keyResults: ['再発注率を20%にする'] }]);
    expect(d.kpis).toEqual(['再発注率']);
    expect(d.missing).toEqual([]);
  });

  it('新規候補は project.id で照合する', () => {
    const d = projectDetailOf({ id: 'proj-c', title: '新市場の探索' }, { official, candidates });
    expect(d.group).toBe('new');
    expect(d.purpose).toBe('新しい顧客層へ広げる');
  });

  it('reason が空文字なら、hypothesis を選定理由として出さない（理由と仮説は別々に扱う）', () => {
    const d = projectDetailOf({ id: 'proj-b', title: '工場間の連携' }, { official, candidates: [] });
    expect(d.purpose).toBeNull();
    expect(d.hypothesis).toBe('工場の在庫が見える');
    expect(d.partnerDepartment).toBe('生産');
    expect(d.group).toBe('interCollab');
    expect(d.missing).toContain('purpose');
  });

  it('照合できない草案は補完せず、要約だけを出し、不足を記録する', () => {
    const d = projectDetailOf({ id: 'unknown', title: '未照合', description: '草案の要約' }, { official, candidates: [] });
    expect(d.purpose).toBeNull();
    expect(d.hypothesis).toBeNull();
    expect(d.summary).toBe('草案の要約');
    expect(d.group).toBe('other');
    expect(d.missing).toEqual(expect.arrayContaining(['purpose', 'hypothesis', 'okrs']));
  });

  it('連携プロジェクトで連携先が無いときは、不足として記録する', () => {
    const d = projectDetailOf(
      { id: 'proj-x', title: '連携案' },
      { official: [{ id: 'proj-x', title: '連携案', reason: '理由', hypothesis: '仮説', sourceType: 'intraCollab' }], candidates: [] },
    );
    expect(d.missing).toContain('partnerDepartment');
  });

  it('空の文字列・空の目標は、表示用の値にしない', () => {
    const d = projectDetailOf(
      { id: 'proj-y', title: '空欄', kpis: ['  ', ''] },
      { official: [{ id: 'proj-y', title: '空欄', reason: '   ', hypothesis: '', okrs: [{ objective: '', keyResults: [] }] }], candidates: [] },
    );
    expect(d.purpose).toBeNull();
    expect(d.hypothesis).toBeNull();
    expect(d.okrs).toEqual([]);
    expect(d.kpis).toEqual([]);
  });
});

describe('projectDetailOf（出どころと、草案の項目の優先）', () => {
  it('正式データの項目は「既存」、新規候補の項目は「新規候補」として区別する', () => {
    const o = projectDetailOf({ id: 'proj-a', title: '既存の保守を強化' }, { official, candidates });
    const c = projectDetailOf({ id: 'proj-c', title: '新市場の探索' }, { official, candidates });
    expect(o.origin).toBe('official');
    expect(c.origin).toBe('candidate');
  });

  it('照合できない草案でも、草案に保存された選定理由と仮説を使う', () => {
    const d = projectDetailOf(
      { id: 'unknown', title: '草案だけの案', reason: '草案の理由', hypothesis: '草案の仮説', sourceType: 'new', okrs: [{ objective: '目標', keyResults: ['指標'] }] },
      { official: [], candidates: [] },
    );
    expect(d.origin).toBe('unmatched');
    expect(d.purpose).toBe('草案の理由');
    expect(d.hypothesis).toBe('草案の仮説');
    expect(d.group).toBe('new');
    expect(d.okrs).toEqual([{ objective: '目標', keyResults: ['指標'] }]);
  });

  it('草案の項目と正式データが両方ある時は、草案の項目を優先する', () => {
    const d = projectDetailOf({ id: 'proj-a', title: '既存の保守を強化', reason: '草案側の理由' }, { official, candidates });
    expect(d.purpose).toBe('草案側の理由');
    expect(d.hypothesis).toBe('点検の提案で稼働率が上がる');
  });
});
