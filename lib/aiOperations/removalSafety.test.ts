import { removalBlockReason } from './removalSafety';

const BASE = {
  businessSegments: [{ id: 'seg-1', name: '製造事業' }],
  stage1Issues: [{ title: '新規顧客の獲得が鈍い', description: '', linkedMetrics: [], scope: 'company' }],
  segmentPL: {},
  segmentBS: {},
} as const;

describe('削除の判定：STAGE2以降のデータがあれば削除しない', () => {
  it('下流のデータが何もなければ、経営課題の削除は認める', () => {
    expect(removalBlockReason({ kind: 'issue.remove', title: '新規顧客の獲得が鈍い' }, BASE as never)).toBeNull();
  });

  it.each([
    ['story', { story: [{ chapter: 1 }] }, 'ストーリー（STAGE2）'],
    ['finalStory', { finalStory: [{ chapter: 1 }] }, '最終ストーリー（STAGE2）'],
    ['midtermStrategy', { midtermStrategy: { targets: [] } }, '中期戦略（STAGE2）'],
    ['departments', { departments: [{ name: '営業部' }] }, '部門（STAGE3）'],
  ])('%s があれば、経営課題を削除しない', (_field, extra, label) => {
    const r = removalBlockReason({ kind: 'issue.remove', title: '新規顧客の獲得が鈍い' }, { ...BASE, ...extra } as never);
    expect(r).toContain(label);
  });

  it('存在しない経営課題や事業は、削除の対象にしない', () => {
    expect(removalBlockReason({ kind: 'issue.remove', title: 'ない題名' }, BASE as never)).toContain('見つかりません');
    expect(removalBlockReason({ kind: 'segment.remove', name: 'ない事業' }, BASE as never)).toContain('見つかりません');
  });

  it('事業に財務データがあれば、削除しない', () => {
    const r = removalBlockReason(
      { kind: 'segment.remove', name: '製造事業' },
      { ...BASE, segmentPL: { 製造事業: [{ year: 2025, revenue: 1 }] } } as never,
    );
    expect(r).toContain('財務データ');
  });

  it('経営課題が事業に紐づいていれば、事業を削除しない', () => {
    const r = removalBlockReason(
      { kind: 'segment.remove', name: '製造事業' },
      { ...BASE, stage1Issues: [{ title: '課題', segmentName: '製造事業' }] } as never,
    );
    expect(r).toContain('紐づいている');
  });
});
