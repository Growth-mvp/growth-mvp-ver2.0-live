import { describeSaveError } from './financePlanSnapshot';

describe('財務計画の保存失敗の文言（REVISION_UNKNOWN）', () => {
  it('revision 不明で拒否された保存は、再読み込みしてから保存し直す案内にする（競合の文言にしない）', () => {
    const msg = describeSaveError({ status: 409, code: 'REVISION_UNKNOWN', message: 'x' });
    expect(msg).toBe(
      'データの確認が完了していないため、保存できませんでした。未保存の入力内容は、再読み込みすると失われる可能性があります。必要な内容を控えてから再読み込みしてください。',
    );
    expect(msg).not.toContain('他の利用者');
  });

  it('従来の競合（REVISION_CONFLICT・409）の文言は変えない', () => {
    expect(describeSaveError({ status: 409, code: 'REVISION_CONFLICT' })).toContain('他の利用者が先に更新');
  });
});
