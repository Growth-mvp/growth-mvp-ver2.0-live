import { safeInternalPath } from './safeRedirect';

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
