import { externalCreatorId, isOrgAlignmentVisibilityMode } from './org-alignment-visibility';

describe('外部レスポンスに出す作成者ID', () => {
  it('匿名投稿の作成者IDは外部に出さない', () => {
    expect(externalCreatorId('anonymous', 'user-1')).toBeNull();
  });

  it('管理者のみ・実名の投稿では作成者IDを返す', () => {
    expect(externalCreatorId('manager_only', 'user-1')).toBe('user-1');
    expect(externalCreatorId('named', 'user-1')).toBe('user-1');
  });

  it('公開範囲が不明な投稿は、安全側に倒して作成者IDを返さない', () => {
    expect(externalCreatorId(null, 'user-1')).toBeNull();
    expect(externalCreatorId('public', 'user-1')).toBeNull();
  });

  it('作成者IDが無い投稿は null', () => {
    expect(externalCreatorId('named', null)).toBeNull();
  });
});

describe('公開範囲の値の検証', () => {
  it.each(['anonymous', 'manager_only', 'named'])('%s は有効', (v) => {
    expect(isOrgAlignmentVisibilityMode(v)).toBe(true);
  });

  it.each(['', 'public', 'Anonymous', undefined, null, 1])('%p は無効', (v) => {
    expect(isOrgAlignmentVisibilityMode(v)).toBe(false);
  });
});
