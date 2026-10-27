import { decideMfaGate } from './mfaGate';

describe('decideMfaGate（ログイン後のゲート）', () => {
  it('セッションが無ければ何もしない', () => {
    expect(decideMfaGate({ hasSession: false, state: null, error: false })).toBe('none');
  });

  it('未登録（aal1 / aal1）は従来どおり通す', () => {
    expect(decideMfaGate({ hasSession: true, state: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: false })).toBe('none');
  });

  it('登録済みで aal1 は追加認証へ誘導する', () => {
    expect(decideMfaGate({ hasSession: true, state: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: false })).toBe('challenge');
  });

  it('aal2 / aal2 は通常利用を許可する', () => {
    expect(decideMfaGate({ hasSession: true, state: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: false })).toBe('none');
  });

  it('状態の取得に失敗したら安全側に倒して認証へ誘導する', () => {
    expect(decideMfaGate({ hasSession: true, state: null, error: true })).toBe('challenge');
  });

  it('状態が不明（null）なら安全側に倒す', () => {
    expect(decideMfaGate({ hasSession: true, state: null, error: false })).toBe('challenge');
  });
});
