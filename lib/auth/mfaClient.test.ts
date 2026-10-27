/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase 応答のモックは意図的に緩く定義している */
import {
  confirmEnrollment,
  discardPendingEnrollment,
  getEnrollmentStatus,
  getVerifiedFactorId,
  isValidCode,
  startEnrollment,
  unenrollFactor,
  verifyChallenge,
  type MfaClient,
} from './mfaClient';

const FACTOR = 'f1-factor';
const QR = 'data:image/svg+xml;base64,QUFB';
const SECRET = 'SECRETSECRETSECRET';

function fakeClient(over: Partial<Record<keyof MfaClient, any>> = {}) {
  const ok = (data: any) => async () => ({ data, error: null });
  const client: MfaClient = {
    listFactors: over.listFactors ?? ok({ all: [], totp: [] }),
    enroll: over.enroll ?? ok({ id: FACTOR, totp: { qr_code: QR, secret: SECRET, uri: 'otpauth://x' } }),
    challenge: over.challenge ?? ok({ id: 'challenge-1' }),
    verify: over.verify ?? ok({}),
    challengeAndVerify: over.challengeAndVerify ?? ok({}),
    unenroll: over.unenroll ?? ok({}),
  } as any;
  return client;
}

const verifiedFactors = { all: [{ id: FACTOR, factor_type: 'totp', status: 'verified' }], totp: [{ id: FACTOR, status: 'verified' }] };
const pendingFactors = { all: [{ id: 'pending-1', factor_type: 'totp', status: 'unverified' }], totp: [] };

describe('isValidCode', () => {
  it('6桁の数字だけを受け付ける', () => {
    expect(isValidCode('123456')).toBe(true);
    expect(isValidCode('12345')).toBe(false);
    expect(isValidCode('12345a')).toBe(false);
    expect(isValidCode('1234567')).toBe(false);
  });
});

describe('getEnrollmentStatus', () => {
  it('検証済みの要素があれば enrolled', async () => {
    const res = await getEnrollmentStatus(fakeClient({ listFactors: async () => ({ data: verifiedFactors, error: null }) }));
    expect(res).toEqual({ ok: true, data: { kind: 'enrolled', factorId: FACTOR } });
  });

  it('未検証の要素だけなら pending', async () => {
    const res = await getEnrollmentStatus(fakeClient({ listFactors: async () => ({ data: pendingFactors, error: null }) }));
    expect(res).toEqual({ ok: true, data: { kind: 'pending', factorId: 'pending-1' } });
  });

  it('要素が無ければ none', async () => {
    const res = await getEnrollmentStatus(fakeClient());
    expect(res).toEqual({ ok: true, data: { kind: 'none' } });
  });

  it('取得に失敗したら unknown（安全側に倒す）', async () => {
    const res = await getEnrollmentStatus(fakeClient({ listFactors: async () => ({ data: null, error: { status: 500 } }) }));
    expect(res).toEqual({ ok: false, code: 'unknown' });
  });
});

describe('startEnrollment（TOTP 登録の開始）', () => {
  it('未登録なら enroll して QR とシークレットを返す', async () => {
    const enroll = jest.fn(async () => ({ data: { id: FACTOR, totp: { qr_code: QR, secret: SECRET } }, error: null }));
    const res = await startEnrollment(fakeClient({ enroll }));

    expect(res).toEqual({ ok: true, data: { factorId: FACTOR, qrCode: QR, secret: SECRET } });
    expect(enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'GROWTH SHIFT' });
  });

  it('途中で止まった未検証の登録があれば、破棄してから登録し直す', async () => {
    const unenroll = jest.fn(async () => ({ data: {}, error: null }));
    const res = await startEnrollment(
      fakeClient({
        listFactors: async () => ({ data: pendingFactors, error: null }),
        unenroll,
      })
    );

    expect(unenroll).toHaveBeenCalledWith({ factorId: 'pending-1' });
    expect(res.ok).toBe(true);
  });

  it('既に登録済みなら登録し直さない（already_enrolled）', async () => {
    const enroll = jest.fn();
    const res = await startEnrollment(
      fakeClient({ listFactors: async () => ({ data: verifiedFactors, error: null }), enroll })
    );

    expect(res).toEqual({ ok: false, code: 'already_enrolled' });
    expect(enroll).not.toHaveBeenCalled();
  });
});

describe('confirmEnrollment（6桁コードで登録を確定）', () => {
  it('正しいコードなら challenge → verify で確定する', async () => {
    const verify = jest.fn(async () => ({ data: {}, error: null }));
    const res = await confirmEnrollment(fakeClient({ verify }), FACTOR, '123456');

    expect(res).toEqual({ ok: true, data: undefined });
    expect(verify).toHaveBeenCalledWith({ factorId: FACTOR, challengeId: 'challenge-1', code: '123456' });
  });

  it('誤ったコードは invalid_code で、再試行できる状態を返す', async () => {
    const res = await confirmEnrollment(
      fakeClient({ verify: async () => ({ data: null, error: { status: 400, code: 'mfa_verification_failed' } }) }),
      FACTOR,
      '000000'
    );
    expect(res).toEqual({ ok: false, code: 'invalid_code' });
  });

  it('試行回数の上限に達したら rate_limited', async () => {
    const res = await confirmEnrollment(
      fakeClient({ verify: async () => ({ data: null, error: { status: 429 } }) }),
      FACTOR,
      '000000'
    );
    expect(res).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('形式が不正なコードは通信せずに拒否する', async () => {
    const verify = jest.fn();
    const res = await confirmEnrollment(fakeClient({ verify }), FACTOR, '12');
    expect(res).toEqual({ ok: false, code: 'invalid_format' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('challenge の失敗は unknown で、verify は呼ばない', async () => {
    const verify = jest.fn();
    const res = await confirmEnrollment(
      fakeClient({ challenge: async () => ({ data: null, error: { status: 500 } }), verify }),
      FACTOR,
      '123456'
    );
    expect(res).toEqual({ ok: false, code: 'unknown' });
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('discardPendingEnrollment（登録の途中中断）', () => {
  it('未検証の登録だけを削除し、検証済みの要素には触れない', async () => {
    const unenroll = jest.fn(async () => ({ data: {}, error: null }));
    await discardPendingEnrollment(fakeClient({ listFactors: async () => ({ data: pendingFactors, error: null }), unenroll }));
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'pending-1' });

    const unenroll2 = jest.fn();
    await discardPendingEnrollment(fakeClient({ listFactors: async () => ({ data: verifiedFactors, error: null }), unenroll: unenroll2 }));
    expect(unenroll2).not.toHaveBeenCalled();
  });
});

describe('verifyChallenge（追加認証）', () => {
  it('正しいコードなら challengeAndVerify が成功する', async () => {
    const challengeAndVerify = jest.fn(async () => ({ data: {}, error: null }));
    const res = await verifyChallenge(fakeClient({ challengeAndVerify }), FACTOR, '123456');
    expect(res.ok).toBe(true);
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR, code: '123456' });
  });

  it('誤ったコードは invalid_code、形式が不正なら通信しない', async () => {
    const bad = await verifyChallenge(
      fakeClient({ challengeAndVerify: async () => ({ data: null, error: { status: 400 } }) }),
      FACTOR,
      '999999'
    );
    expect(bad).toEqual({ ok: false, code: 'invalid_code' });

    const challengeAndVerify = jest.fn();
    const invalid = await verifyChallenge(fakeClient({ challengeAndVerify }), FACTOR, 'abc');
    expect(invalid).toEqual({ ok: false, code: 'invalid_format' });
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });
});

describe('unenrollFactor（登録の解除）', () => {
  it('解除できれば ok', async () => {
    const unenroll = jest.fn(async () => ({ data: {}, error: null }));
    expect(await unenrollFactor(fakeClient({ unenroll }), FACTOR)).toEqual({ ok: true, data: undefined });
    expect(unenroll).toHaveBeenCalledWith({ factorId: FACTOR });
  });

  it('aal2 が無いと拒否されたら needs_aal2', async () => {
    const res = await unenrollFactor(
      fakeClient({ unenroll: async () => ({ data: null, error: { status: 403, code: 'insufficient_aal' } }) }),
      FACTOR
    );
    expect(res).toEqual({ ok: false, code: 'needs_aal2' });
  });

  it('その他の失敗は unknown', async () => {
    const res = await unenrollFactor(fakeClient({ unenroll: async () => ({ data: null, error: { status: 500 } }) }), FACTOR);
    expect(res).toEqual({ ok: false, code: 'unknown' });
  });
});

describe('getVerifiedFactorId', () => {
  it('検証済みの要素の ID を返す。無ければ null', async () => {
    expect(await getVerifiedFactorId(fakeClient({ listFactors: async () => ({ data: verifiedFactors, error: null }) }))).toEqual({
      ok: true,
      data: FACTOR,
    });
    expect(await getVerifiedFactorId(fakeClient())).toEqual({ ok: true, data: null });
  });
});

describe('ログへの出力（QR・シークレット・コード）', () => {
  it('操作中に console へ何も出さない', async () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map((l) => jest.spyOn(console, l as 'log').mockImplementation(() => undefined));
    try {
      await startEnrollment(fakeClient());
      await confirmEnrollment(fakeClient(), FACTOR, '123456');
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
