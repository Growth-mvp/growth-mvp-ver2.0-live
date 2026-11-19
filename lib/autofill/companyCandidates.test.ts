import { candidateFromDocument, tickerOfSecCode, type EdinetDocument } from './companyCandidates';

const NOW = '2026-11-19T00:00:00.000Z';
const DOC: EdinetDocument = {
  docId: 'S100TEST',
  secCode: '59050',
  edinetCode: 'E00001',
  filerName: '日本製罐株式会社',
  docTypeCode: '120',
  docDescription: '有価証券報告書',
  periodStart: '2025-04-01',
  periodEnd: '2026-03-31',
  submitDate: '2026-06-20',
  withdrawn: false,
};

describe('入力候補：書類から作る（推測で補わない）', () => {
  it('証券コードは5桁（末尾0）から4桁の東証コードに直す', () => {
    expect(tickerOfSecCode('59050')).toBe('5905');
    expect(tickerOfSecCode('5905')).toBe('5905');
    expect(tickerOfSecCode('59051')).toBeNull();
    expect(tickerOfSecCode(null)).toBeNull();
  });

  it('会社名・証券コード・上場・決算月を、出典つきで候補にする', () => {
    const c = candidateFromDocument(DOC, NOW);
    expect(c.fields.companyName?.value).toBe('日本製罐株式会社');
    expect(c.fields.ticker?.value).toBe('5905');
    expect(c.fields.isListed?.value).toBe(true);
    expect(c.fields.fiscalYearEnd?.value).toBe('3');
    expect(c.fields.fiscalYearEnd?.fiscalYear).toBe(2026);
    expect(c.fields.ticker?.source).toEqual({ source: 'EDINET', docId: 'S100TEST', docTypeCode: '120', periodEnd: '2026-03-31', fetchedAt: NOW });
  });

  it('連結・単体は書類から確認できないため「未確認」と示す（候補の値は UNKNOWN）', () => {
    const c = candidateFromDocument(DOC, NOW);
    expect(c.fields.companyName?.consolidation).toBe('UNKNOWN');
    expect(c.issues.join('')).toContain('連結・単体は提出書類の情報からは確認できていません');
  });

  it('証券コードが無い・形式が違う書類では、上場情報を候補にしない（未入力のまま）', () => {
    const c = candidateFromDocument({ ...DOC, secCode: null }, NOW);
    expect(c.fields.ticker).toBeUndefined();
    expect(c.fields.isListed).toBeUndefined();
    expect(c.issues.join('')).toContain('証券コードが取得できない');
  });

  it('期末が読めない時は決算月を候補にしない', () => {
    const c = candidateFromDocument({ ...DOC, periodEnd: '不明' }, NOW);
    expect(c.fields.fiscalYearEnd).toBeUndefined();
    expect(c.issues.join('')).toContain('決算期末');
  });
});
