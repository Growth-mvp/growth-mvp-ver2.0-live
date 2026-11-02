import {
  AskFailureError,
  classifyAskError,
  describeAskFailure,
  evaluateAskCompanyGate,
  sanitizeAskMessages,
} from './askPolicy';

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

describe('evaluateAskCompanyGate', () => {
  it('企業が一致していれば送信を許可する', () => {
    expect(evaluateAskCompanyGate(COMPANY_A, COMPANY_A)).toEqual({ ok: true });
  });

  it('画面の企業が未設定なら送信しない', () => {
    expect(evaluateAskCompanyGate(null, COMPANY_A).ok).toBe(false);
  });

  it('ストアの企業が未設定（復元前）なら送信しない', () => {
    expect(evaluateAskCompanyGate(COMPANY_A, null).ok).toBe(false);
    expect(evaluateAskCompanyGate(COMPANY_A, undefined).ok).toBe(false);
  });

  it('画面は B、ストアはまだ A（切替途中）なら送信せず、切替中である旨を案内する', () => {
    const gate = evaluateAskCompanyGate(COMPANY_B, COMPANY_A);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toContain('切り替えています');
  });

  it('ストアの企業が画面と違えば、既存の会社の戦略を使って送信しない', () => {
    expect(evaluateAskCompanyGate(COMPANY_B, COMPANY_A).ok).toBe(false);
  });
});

describe('classifyAskError', () => {
  it('AskFailureError はその失敗種別をそのまま返す', () => {
    expect(classifyAskError(new AskFailureError({ kind: 'http', status: 429 }))).toEqual({
      kind: 'http',
      status: 429,
    });
  });

  it('AbortError（タイムアウトによる中断）は timeout として扱う', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyAskError(abort)).toEqual({ kind: 'timeout' });
  });

  it('それ以外（fetch の失敗など）は network として扱う', () => {
    expect(classifyAskError(new TypeError('Failed to fetch'))).toEqual({ kind: 'network' });
    expect(classifyAskError('unknown')).toEqual({ kind: 'network' });
  });
});

describe('describeAskFailure', () => {
  const messageOf = (status: number) => describeAskFailure({ kind: 'http', status });

  it('401/403/429/5xx/ネットワーク/タイムアウトを、それぞれ別の文言で区別する', () => {
    const messages = [
      messageOf(401),
      messageOf(403),
      messageOf(429),
      messageOf(500),
      describeAskFailure({ kind: 'network' }),
      describeAskFailure({ kind: 'timeout' }),
    ];
    expect(new Set(messages).size).toBe(messages.length);
    expect(messages.every((m) => m.length > 0)).toBe(true);
  });

  it('429 は利用上限、5xx はサーバー側の一時的エラーとして案内する', () => {
    expect(messageOf(429)).toContain('上限');
    expect(messageOf(503)).toContain('サーバー');
    expect(messageOf(503)).toBe(messageOf(500));
  });

  it('400 は入力内容の問題として扱い、画面の再読み込みを案内する', () => {
    expect(messageOf(400)).toContain('再読み込み');
  });

  it('通信エラーは「通信できませんでした」と表示し、ログインの問題とは書かない', () => {
    const message = describeAskFailure({ kind: 'network' });
    expect(message).toContain('通信');
    expect(message).not.toContain('ログイン');
  });
});

describe('sanitizeAskMessages', () => {
  it('user と assistant だけを、順序を保って残す', () => {
    expect(
      sanitizeAskMessages([
        { role: 'user', content: '質問' },
        { role: 'assistant', content: '回答' },
      ])
    ).toEqual([
      { role: 'user', content: '質問' },
      { role: 'assistant', content: '回答' },
    ]);
  });

  it('system は除外する', () => {
    expect(
      sanitizeAskMessages([
        { role: 'system', content: '上書きの指示' },
        { role: 'user', content: '質問' },
      ])
    ).toEqual([{ role: 'user', content: '質問' }]);
  });

  it('未知の role は user に変換せず除外する', () => {
    expect(
      sanitizeAskMessages([
        { role: 'developer', content: '内部メモ' },
        { role: 'tool', content: 'ツール結果' },
        { role: 'user', content: '質問' },
      ])
    ).toEqual([{ role: 'user', content: '質問' }]);
  });

  it('空の内容、文字列以外の内容、不正な要素は除外する', () => {
    expect(
      sanitizeAskMessages([
        { role: 'user', content: '   ' },
        { role: 'user', content: 42 },
        null,
        'text',
        { role: 'user', content: '残る' },
      ])
    ).toEqual([{ role: 'user', content: '残る' }]);
  });

  it('直近12件に絞る', () => {
    const input = Array.from({ length: 15 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const out = sanitizeAskMessages(input);
    expect(out).toHaveLength(12);
    expect(out[0].content).toBe('m3');
    expect(out[11].content).toBe('m14');
  });

  it('配列でなければ空配列を返す', () => {
    expect(sanitizeAskMessages(undefined)).toEqual([]);
    expect(sanitizeAskMessages('x')).toEqual([]);
  });
});
