import fs from 'node:fs';
import path from 'node:path';
import type { EdinetDocument } from './companyCandidates';
import { buildFilingCandidate, planFilingApply, type CurrentFilingProfile } from './filingCandidates';
import { parseEdinetCsv } from './edinetZip';
import { extractFacts } from './xbrlFacts';

const FIX = path.join(__dirname, '__fixtures__');
const facts = extractFacts(parseEdinetCsv(fs.readFileSync(path.join(FIX, 'nisshin-s100yk2j-main-subset.tsv'), 'utf8')));
const DOC: EdinetDocument = {
  docId: 'S100YK2J',
  secCode: '59050',
  edinetCode: 'E01408',
  filerName: '日本製罐株式会社',
  docTypeCode: '120',
  docDescription: '有価証券報告書－第121期(2025/04/01－2026/03/31)',
  periodStart: '2025-04-01',
  periodEnd: '2026-03-31',
  submitDate: '2026-06-25 15:00',
  withdrawn: false,
};
const NOW = '2026-11-19T03:00:00.000Z';
const EMPTY: CurrentFilingProfile = {
  companyName: '',
  ticker: '',
  fiscalYearEnd: '',
  isListed: undefined,
  location: '',
  employees: '',
  businessContent: '',
  industry: '',
};

describe('候補：出典と連結区分を項目ごとに持つ', () => {
  const c = buildFilingCandidate({ doc: DOC, facts, fetchedAt: NOW, amendedFromDocId: null });

  it('財務の値は、連結（照合済み）・円・書類ID・年度つき', () => {
    const y2026 = c.finance.find((y) => y.year === 2026)!;
    expect(y2026.revenue).toMatchObject({
      value: 11442246000,
      fiscalYear: 2026,
      consolidation: 'CONSOLIDATED',
      source: { docId: 'S100YK2J', docTypeCode: '120' },
    });
    expect(y2026.operatingIncome?.value).toBe(-307863000);
  });

  it('所在地は会社の所在地、従業員数は連結・単体未確認、事業内容は原資料の文言', () => {
    expect(c.profileExtra.location).toMatchObject({ value: '埼玉県さいたま市北区吉野町２丁目275番地', consolidation: 'NOT_APPLICABLE' });
    expect(c.profileExtra.employees).toMatchObject({ value: 189, consolidation: 'UNKNOWN' });
    expect(c.profileExtra.businessContent?.value).toContain('日本製罐株式会社）及び子会社１社');
  });

  it('業種とセグメントは書類から取り出せていないため、候補にせず、その旨を示す', () => {
    expect(c.issues.join('')).toContain('業種（東証33業種）は提出書類の構造化データに無いため、未入力');
    expect(c.issues.join('')).toContain('事業セグメントの名称と金額');
  });

  it('訂正報告書を採用した時は、元の有価証券報告書との関係を示す', () => {
    const a = buildFilingCandidate({ doc: { ...DOC, docId: 'AMEND', docTypeCode: '130' }, facts, fetchedAt: NOW, amendedFromDocId: 'S100YK2J' });
    expect(a.amendedFromDocId).toBe('S100YK2J');
    expect(a.issues.join('')).toContain('訂正報告書（AMEND）の値を採用');
  });
});

describe('反映の計画：既存の入力は守り、承認された項目・年度だけ反映する', () => {
  const c = buildFilingCandidate({ doc: DOC, facts, fetchedAt: NOW, amendedFromDocId: null });

  it('入力が空なら、承認された項目と年度を反映する（年度ごとの行を作る）', () => {
    const plan = planFilingApply({
      current: EMPTY,
      currentFinance: [],
      candidate: c,
      selectedProfile: ['companyName', 'ticker', 'location', 'employees'],
      overwriteProfile: [],
      selectedYears: [2026],
      overwriteYears: [],
    });
    expect(plan.profilePatch).toEqual({ companyName: '日本製罐株式会社', ticker: '5905', location: '埼玉県さいたま市北区吉野町２丁目275番地', employees: '189' });
    expect(plan.financeRows).toEqual([expect.objectContaining({ year: 2026, revenue: 11442246000, operatingIncome: -307863000, netIncome: -346736000 })]);
  });

  it('既存の売上高が違う年度は、上書きを選ばない限り変えない', () => {
    const plan = planFilingApply({
      current: EMPTY,
      currentFinance: [{ year: 2026, revenue: 1 }],
      candidate: c,
      selectedProfile: [],
      overwriteProfile: [],
      selectedYears: [2026],
      overwriteYears: [],
    });
    expect(plan.financeSkipped).toContainEqual({ year: 2026, key: 'revenue', reason: 'already_filled' });
    expect(plan.financeRows.find((r) => r.year === 2026)?.revenue).toBe(1);
  });

  it('既存の値が同じなら、変更しない（同じ値として記録する）', () => {
    const plan = planFilingApply({
      current: EMPTY,
      currentFinance: [{ year: 2026, revenue: 11442246000 }],
      candidate: c,
      selectedProfile: [],
      overwriteProfile: [],
      selectedYears: [2026],
      overwriteYears: [],
    });
    expect(plan.financeSkipped).toContainEqual({ year: 2026, key: 'revenue', reason: 'same_value' });
  });

  it('上書きを選んだ年度だけ、既存の値を置き換える（他の年度・項目は変えない）', () => {
    const plan = planFilingApply({
      current: EMPTY,
      currentFinance: [{ year: 2026, revenue: 1, netAssets: 999 }, { year: 2025, revenue: 2 }],
      candidate: c,
      selectedProfile: [],
      overwriteProfile: [],
      selectedYears: [2026],
      overwriteYears: [2026],
    });
    const row = plan.financeRows.find((r) => r.year === 2026)!;
    expect(row.revenue).toBe(11442246000);
    expect(row.netAssets).toBe(4856436000);
    expect(plan.financeRows.find((r) => r.year === 2025)?.revenue).toBe(2);
  });

  it('入力済みの会社名は、上書きを選ばない限り変えない', () => {
    const plan = planFilingApply({
      current: { ...EMPTY, companyName: '既存の社名' },
      currentFinance: [],
      candidate: c,
      selectedProfile: ['companyName'],
      overwriteProfile: [],
      selectedYears: [],
      overwriteYears: [],
    });
    expect(plan.profilePatch).toEqual({});
    expect(plan.profileSkipped).toEqual([{ key: 'companyName', reason: 'already_filled' }]);
  });

  it('候補が無い年度（営業利益の2022年）は、反映しない', () => {
    const plan = planFilingApply({
      current: EMPTY,
      currentFinance: [],
      candidate: c,
      selectedProfile: [],
      overwriteProfile: [],
      selectedYears: [2022],
      overwriteYears: [],
    });
    expect(plan.financeRows.find((r) => r.year === 2022)?.operatingIncome).toBeUndefined();
    expect(plan.financeSkipped).toContainEqual({ year: 2022, key: 'operatingIncome', reason: 'no_candidate' });
  });
});
