import { authErrorFromHash, postLoginDestination, safeInternalPath } from './safeRedirect';

describe('safeInternalPath', () => {
  it('アプリ内パスはそのまま返す（クエリも保持）', () => {
    expect(safeInternalPath('/invite/accept?token=abc')).toBe('/invite/accept?token=abc');
    expect(safeInternalPath(' /stage2 ')).toBe('/stage2');
  });

  it('未指定・空は null', () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath('')).toBeNull();
  });

  it('外部オリジンを指す値は拒否する', () => {
    expect(safeInternalPath('https://evil.example/')).toBeNull();
    expect(safeInternalPath('//evil.example/path')).toBeNull();
    expect(safeInternalPath('/\\evil.example')).toBeNull();
  });

  it('制御文字を含む値は拒否する', () => {
    expect(safeInternalPath('/ok\nhttps://evil.example')).toBeNull();
  });
});

describe('postLoginDestination', () => {
  it('redirect_to を優先し、無ければ next を使う', () => {
    expect(postLoginDestination(new URLSearchParams('redirect_to=/invite/accept&next=/x'))).toBe('/invite/accept');
    expect(postLoginDestination(new URLSearchParams('next=/invite/accept'))).toBe('/invite/accept');
  });

  it('外部へのURLは拒否する', () => {
    expect(postLoginDestination(new URLSearchParams('next=//evil.example'))).toBeNull();
    expect(postLoginDestination(new URLSearchParams('redirect_to=https://evil.example'))).toBeNull();
    expect(postLoginDestination(new URLSearchParams(''))).toBeNull();
  });
});

describe('authErrorFromHash', () => {
  it('期限切れ・使用済みの確認リンクのエラーを読む', () => {
    expect(authErrorFromHash('#error=access_denied&error_code=otp_expired&sb=')).toEqual({ code: 'otp_expired' });
  });

  it('エラーが無ければ null', () => {
    expect(authErrorFromHash('#access_token=abc&type=signup')).toBeNull();
    expect(authErrorFromHash('')).toBeNull();
  });
});
