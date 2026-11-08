import { readFileSync } from 'fs';
import path from 'path';

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');

describe('STAGE5：旧方式の金額を財務試算の値として表示しない', () => {
  it('「STAGE6に反映」「旧見込み」の金額表示と、確度による旧金額の計算を含まない', () => {
    expect(source).not.toContain('STAGE6に反映');
    expect(source).not.toContain('旧見込み');
    expect(source).not.toContain('calcStage6Projection');
    expect(source).not.toContain('現時点の見込み');
    expect(source).not.toContain('impactRevenueConfidence');
  });

  it('作業進捗率の入力と、STAGE4の目標の表示は残す', () => {
    expect(source).toContain('作業進捗率%');
    expect(source).toContain("handleProgressChange('impactRevenueProgress'");
    expect(source).toContain("handleProgressChange('impactOpIncomeProgress'");
    expect(source).toContain('売上の目標（STAGE4）');
  });

  it('財務試算には反映されないことを、利用者に明示する', () => {
    expect(source).toContain('財務試算には未反映');
    expect(source).not.toMatch(/反映されます。\s*\n/);
  });
});
