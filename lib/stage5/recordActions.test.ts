import { canEditRecord, recordKindOf } from './recordActions';

describe('recordKindOf', () => {
  it('[FB] で始まる記録はフィードバック、それ以外は社内共有', () => {
    expect(recordKindOf('[FB]\n見直しましょう')).toBe('feedback');
    expect(recordKindOf('顧客の洗い出し中')).toBe('share');
    expect(recordKindOf('')).toBe('share');
  });
});

describe('canEditRecord', () => {
  const base = { rowUserId: 'u-me', viewerUserId: 'u-me', canFeedback: false };

  it('本人の社内共有は、フィードバック権限がなくても編集・削除できる', () => {
    expect(canEditRecord({ ...base, kind: 'share' })).toBe(true);
  });

  it('他の人の社内共有は、権限があっても編集・削除できない', () => {
    expect(canEditRecord({ ...base, rowUserId: 'u-other', kind: 'share', canFeedback: true })).toBe(false);
  });

  it('本人のフィードバックは、フィードバック権限がある場合だけ編集・削除できる', () => {
    expect(canEditRecord({ ...base, kind: 'feedback', canFeedback: true })).toBe(true);
    expect(canEditRecord({ ...base, kind: 'feedback', canFeedback: false })).toBe(false);
  });

  it('他の人のフィードバックは、権限があっても編集・削除できない', () => {
    expect(canEditRecord({ ...base, rowUserId: 'u-manager', kind: 'feedback', canFeedback: true })).toBe(false);
  });

  it('投稿者が不明、または利用者が不明な記録は操作できない', () => {
    expect(canEditRecord({ ...base, rowUserId: undefined, kind: 'share' })).toBe(false);
    expect(canEditRecord({ ...base, viewerUserId: null, kind: 'share' })).toBe(false);
    expect(canEditRecord({ ...base, rowUserId: '', viewerUserId: '', kind: 'share' })).toBe(false);
  });
});
