import { formatTarget } from './adapter';

describe('KPIの目標値の表示（未設定と0を区別し、単位の位置を揃える）', () => {
  it('未設定（null・undefined）は表示しない（呼び出し側で「未設定」と出す）', () => {
    expect(formatTarget(null, '¥')).toBeNull();
    expect(formatTarget(undefined, '%')).toBeNull();
  });

  it('設定された0は0と表示する（未設定とは別）', () => {
    expect(formatTarget(0, '%')).toBe('0%');
    expect(formatTarget(0, '件')).toBe('0件');
  });

  it('円の単位（¥）は前に付ける', () => {
    expect(formatTarget(0, '¥')).toBe('¥0');
    expect(formatTarget(1200000, '¥')).toBe('¥1200000');
  });
});
