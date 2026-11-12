import { stage2StatusOf } from './stage2Status';

const story = [
  { title: '顧客の課題', body: '既存顧客は再発注の手続きに時間をかけている' },
  { title: '自社が選ばれる理由', body: '手続きを半分にできる点' },
];

describe('stage2StatusOf（STAGE2確定版の判定）', () => {
  it('確定記録があり、結論が空でも、本文があれば確定済み（今回の不具合の再現）', () => {
    const edits = { confirmed: { conclusion: '', assumptions: { external: ['市場は横ばい'], internal: [], implications: [] } } };
    const result = stage2StatusOf(edits, story);
    expect(result.status).toBe('confirmed');
    if (result.status !== 'confirmed') return;
    expect(result.companyStrategy).toContain('顧客の課題');
    expect(result.companyStrategy).toContain('手続きを半分にできる点');
    expect(result.companyStrategy).toContain('外部環境の前提（判断基準）: 市場は横ばい');
    expect(result.companyStrategy).not.toContain('結論:');
  });

  it('確定記録の結論を使う（下書きの結論は使わない）', () => {
    const edits = {
      conclusion: '下書きの結論',
      draftChangedAt: '2026-11-05T00:00:00.000Z',
      confirmed: { conclusion: '確定した結論', assumptions: {}, confirmedAt: '2026-11-01T00:00:00.000Z' },
    };
    const result = stage2StatusOf(edits, story);
    expect(result).toMatchObject({ status: 'confirmed' });
    if (result.status !== 'confirmed') return;
    expect(result.companyStrategy).toContain('結論: 確定した結論');
    expect(result.companyStrategy).not.toContain('下書きの結論');
  });

  it('確定版がなく下書きだけなら未確定（AI草案を確定扱いにしない）', () => {
    expect(stage2StatusOf({ conclusion: '下書き', draftChangedAt: '2026-11-02T00:00:00.000Z' }, null, story)).toEqual({
      status: 'not_confirmed',
    });
    expect(stage2StatusOf(undefined, null)).toEqual({ status: 'not_confirmed' });
    expect(stage2StatusOf({}, [], story)).toEqual({ status: 'not_confirmed' });
  });

  it('確定版があり、確定記録がなくても下書きの印があれば、STAGE2画面と同じく確定済み（今回の不整合の対象）', () => {
    const result = stage2StatusOf({ draftChangedAt: '2026-11-11T05:50:16.226Z' }, story, story);
    expect(result).toMatchObject({ status: 'confirmed', pendingChanges: false });
    if (result.status !== 'confirmed') return;
    expect(result.companyStrategy).toContain('顧客の課題');
  });

  it('確定版の上に新しい草案がある場合は確定済みのまま、未確定の変更として伝える', () => {
    const draft = [
      { title: '顧客の課題', body: '新しい草案の本文' },
      { title: '自社が選ばれる理由', body: '手続きを半分にできる点' },
    ];
    const result = stage2StatusOf({ draftChangedAt: '2026-11-12T00:00:00.000Z' }, story, draft);
    expect(result).toMatchObject({ status: 'confirmed', pendingChanges: true });
    if (result.status !== 'confirmed') return;
    expect(result.companyStrategy).not.toContain('新しい草案の本文');
  });

  it('確定記録があり編集中の章が確定版と同じなら、未確定の変更はない', () => {
    const edits = { confirmed: { conclusion: '結論', assumptions: {}, confirmedAt: '2026-11-01T00:00:00.000Z' } };
    expect(stage2StatusOf(edits, story, story)).toMatchObject({ status: 'confirmed', pendingChanges: false });
  });

  it('確定記録があるのに本文がなければ、未確定とは別の「本文欠落」', () => {
    expect(stage2StatusOf({ confirmed: { conclusion: '結論', assumptions: {} } }, [])).toEqual({ status: 'story_missing' });
    expect(stage2StatusOf({ confirmed: { conclusion: '結論', assumptions: {} } }, [{ title: '', body: '' }])).toEqual({
      status: 'story_missing',
    });
  });

  it('旧データ（確定記録はないが本文だけがあり、下書きの変更もない）は、STAGE2画面と同じく確定版として扱う', () => {
    const result = stage2StatusOf({}, story);
    expect(result).toMatchObject({ status: 'confirmed' });
  });
});
