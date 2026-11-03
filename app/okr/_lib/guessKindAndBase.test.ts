import { guessKindAndBase } from './okrModels';

describe('KRの種類の推定（P0-4）：判定できない指標は顧客獲得にしない', () => {
  it('新規商談数は根拠のある顧客獲得（ACQ）のまま', () => {
    expect(guessKindAndBase('新規商談数').kind).toBe('ACQ');
  });

  it('解約率は解約率（CHURN）のまま', () => {
    expect(guessKindAndBase('解約率を下げる').kind).toBe('CHURN');
  });

  it('売上を伸ばす指標は売上（REVENUE）', () => {
    expect(guessKindAndBase('売上を伸ばす').kind).toBe('REVENUE');
  });

  it.each(['保守契約の継続率', '点検報告の当日提出率', 'NPSを向上させる'])(
    '%s は顧客獲得にも解約率にもせず、活動指標（ACTIVITY）にする',
    (label) => {
      const { kind } = guessKindAndBase(label);
      expect(kind).toBe('ACTIVITY');
      expect(kind).not.toBe('ACQ');
      expect(kind).not.toBe('CHURN');
    }
  );
});
