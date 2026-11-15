import { formatYenScaled } from './yenScale';

describe('formatYenScaled（金額の規模に応じた単位）', () => {
  it('少額は円、万円台は万円、億未満は万円、大きい額は百万円で表す', () => {
    expect(formatYenScaled(2_500)).toBe('2,500円');
    expect(formatYenScaled(60_000)).toBe('6万円');
    expect(formatYenScaled(188_000)).toBe('18.8万円');
    expect(formatYenScaled(720_000)).toBe('72万円');
    expect(formatYenScaled(12_000_000)).toBe('1,200万円');
    expect(formatYenScaled(200_000_000)).toBe('200百万円');
  });

  it('負の額は符号を付け、0は0円と表す。0百万円にはしない', () => {
    expect(formatYenScaled(-100_000)).toBe('−10万円');
    expect(formatYenScaled(0)).toBe('0円');
    expect(formatYenScaled(Number.NaN)).toBe('未算定');
  });
});
