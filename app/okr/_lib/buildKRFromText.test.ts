import { buildKRFromText } from './okrModels';

describe('buildKRFromText：目標の未設定を0にしない', () => {
  it('数字の無いKPI名は、目標を未設定（undefined）にする', () => {
    const kr = buildKRFromText('新聞の定刻・完全配達率（％）');
    expect(kr.target).toBeUndefined();
    expect(kr.unit).toBe('%');
  });

  it('数字を含む文は、その数字を目標にする', () => {
    expect(buildKRFromText('新規商談数 30件').target).toBe(30);
  });
});
