import { decideMfaAccess, needsStepUp } from './mfaPolicy';

describe('needsStepUp（クライアントの追加認証判定）', () => {
  it('登録済みで aal1 のセッションは追加認証が必要', () => {
    expect(needsStepUp({ currentLevel: 'aal1', nextLevel: 'aal2' })).toBe(true);
  });

  it('aal2 のセッションは追加認証が不要', () => {
    expect(needsStepUp({ currentLevel: 'aal2', nextLevel: 'aal2' })).toBe(false);
  });

  it('未登録（nextLevel が aal1）は追加認証が不要', () => {
    expect(needsStepUp({ currentLevel: 'aal1', nextLevel: 'aal1' })).toBe(false);
  });

  it('状態が不明（null）なら追加認証は要求しない（判定できないものは、サーバー側で止める）', () => {
    expect(needsStepUp({ currentLevel: null, nextLevel: null })).toBe(false);
  });
});

describe('decideMfaAccess（サーバーのMFAガード判定）', () => {
  it('検証済み factor があり aal1 の JWT は拒否する（mfa_required）', () => {
    expect(decideMfaAccess({ aal: 'aal1', hasVerifiedFactor: true })).toEqual({
      allowed: false,
      reason: 'mfa_required',
    });
  });

  it('検証済み factor があり aal クレームが無い JWT も拒否する（fail closed）', () => {
    expect(decideMfaAccess({ aal: undefined, hasVerifiedFactor: true })).toEqual({
      allowed: false,
      reason: 'mfa_required',
    });
  });

  it('検証済み factor があり aal2 の JWT は通す', () => {
    expect(decideMfaAccess({ aal: 'aal2', hasVerifiedFactor: true })).toEqual({ allowed: true });
  });

  it('未登録のユーザーは aal1 でも通す（段階導入のため既存利用者を止めない）', () => {
    expect(decideMfaAccess({ aal: 'aal1', hasVerifiedFactor: false })).toEqual({ allowed: true });
  });

  it('想定外の aal 値は、登録の有無に関係なく拒否する', () => {
    expect(decideMfaAccess({ aal: 'aal3', hasVerifiedFactor: false })).toEqual({
      allowed: false,
      reason: 'invalid_aal',
    });
    expect(decideMfaAccess({ aal: 42, hasVerifiedFactor: false })).toEqual({
      allowed: false,
      reason: 'invalid_aal',
    });
  });

  it('免除されたルートは、登録済みで aal1 でも通す（MFA 登録・認証・招待受諾など）', () => {
    expect(decideMfaAccess({ aal: 'aal1', hasVerifiedFactor: true, exempt: true })).toEqual({ allowed: true });
  });
});
