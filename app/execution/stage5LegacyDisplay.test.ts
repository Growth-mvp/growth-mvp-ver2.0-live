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

  it('作業進捗率は通常画面の入力から外し、既存データは参考として残す。旧目標カードは表示しない', () => {
    expect(source).not.toContain('作業進捗率（%）');
    expect(source).not.toContain('handleWorkProgressChange');
    expect(source).toContain('workProgressPct');
    expect(source).toContain('過去の作業進捗率（参考）');
    expect(source).not.toContain("onChange={(e) => handleProgressChange('impactRevenueProgress'");
    expect(source).not.toContain("handleProgressChange('impactOpIncomeProgress'");
    expect(source).not.toContain('売上の目標（STAGE4）');
    expect(source).not.toContain('営業利益の目標（STAGE4）');
  });

  it('進捗率は財務試算に入らないことを、利用者に明示する', () => {
    expect(source).toContain('財務効果や実績には換算しません');
  });
});
