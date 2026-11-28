import { createHash } from 'node:crypto';
import { riskFingerprint } from './companionRiskClaim';
import { jstDateOf, jstDateTimeLabel, jstDayKey } from './jst';

const fact = (text: string) => ({ category: 'CASH' as const, text });

describe('経営点検の事実の指紋（SHA-256）', () => {
  it('SHA-256の16進数（64文字）で、事実の本文から計算する', () => {
    const facts = [fact('2026年度：不足'), fact('2027年度：不足')];
    const expected = createHash('sha256').update('2026年度：不足\n2027年度：不足', 'utf8').digest('hex');
    expect(riskFingerprint(facts)).toBe(expected);
    expect(riskFingerprint(facts)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同じ事実なら同じ指紋、金額が変われば別の指紋になる', () => {
    expect(riskFingerprint([fact('a')])).toBe(riskFingerprint([fact('a')]));
    expect(riskFingerprint([fact('a')])).not.toBe(riskFingerprint([fact('b')]));
    expect(riskFingerprint([fact('a'), fact('b')])).not.toBe(riskFingerprint([fact('b'), fact('a')]));
  });
});

describe('日本時間（Asia/Tokyo）での日付の統一', () => {
  it('日付の区切りは日本時間の0時（UTCの15時）', () => {
    expect(jstDateOf(new Date('2026-11-27T14:59:59Z'))).toBe('2026-11-27');
    expect(jstDateOf(new Date('2026-11-27T15:00:00Z'))).toBe('2026-11-28');
    expect(jstDayKey(Date.parse('2026-11-27T15:00:00Z'))).toBe('2026-11-28');
  });

  it('点検日時の表示は日本時間で、分を2桁にする', () => {
    expect(jstDateTimeLabel('2027-06-15T00:05:00Z')).toBe('2027年6月15日 9時05分（日本時間）');
    expect(jstDateTimeLabel(undefined)).toBeNull();
    expect(jstDateTimeLabel('not a date')).toBeNull();
  });
});
