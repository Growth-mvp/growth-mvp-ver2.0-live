import fs from 'node:fs';
import path from 'node:path';
import { parseEdinetCsv } from './edinetZip';
import { extractFacts, type ExtractedFacts } from './xbrlFacts';
import { extractSegments } from './segments';
import { buildMultiYearCandidate, type FilerInfo, type ReportExtract } from './assemble';

const FIX = path.join(__dirname, '__fixtures__');
const rows = parseEdinetCsv(fs.readFileSync(path.join(FIX, 'nisshin-s100yk2j-main-subset.tsv'), 'utf8'));
const latestFacts = extractFacts(rows);
const latestSeg = extractSegments(rows, '2026-03-31');

const FILER: FilerInfo = {
  name: '日本製罐株式会社',
  secCode: '5905',
  edinetCode: 'E01408',
  listed: true,
  industryName: '金属製品',
  address: 'さいたま市北区吉野町２丁目２７５番地',
};

const LATEST: ReportExtract = {
  docId: 'S100YK2J',
  docTypeCode: '120',
  periodEnd: '2026-03-31',
  submitDate: '2026-06-25',
  amendedFromDocId: null,
  facts: latestFacts,
  segments: latestSeg,
};

const NOSEG = { periodEnd: null, items: [], totals: {}, names: [], checks: [], issues: [] };
const OLDER = (over: Partial<ExtractedFacts>, docId = 'S100OLD2', periodEnd = '2024-03-31'): ReportExtract => ({
  docId,
  docTypeCode: '120',
  periodEnd,
  submitDate: '2024-06-20',
  amendedFromDocId: null,
  facts: { ...latestFacts, pl: [], bs: [], checks: [], consolidationConfirmed: true, issues: [], ...over },
  segments: NOSEG,
});

const NOW = '2026-11-19T03:00:00.000Z';

describe('直近5期の統合（新しい書類の値を優先し、食い違いを残す）', () => {
  it('直近の書類だけでも、5期の売上・純利益・総資産・純資産を揃える。営業利益は書類にある2期だけ（0で埋めない）', () => {
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST], fetchedAt: NOW });
    expect(c.fiscalYear).toBe(2026);
    expect(c.finance.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    const y2026 = c.finance.find((y) => y.year === 2026)!;
    expect(y2026.revenue).toMatchObject({ value: 11442246000, source: { docId: 'S100YK2J' }, consolidation: 'CONSOLIDATED' });
    expect(y2026.totalAssets?.value).toBe(12975874000);
    const y2022 = c.finance.find((y) => y.year === 2022)!;
    expect(y2022.revenue?.value).toBe(10472199000);
    expect(y2022.operatingIncome).toBeUndefined();
    expect(c.finance.find((y) => y.year === 2025)?.operatingIncome?.value).toBe(-540734000);
  });

  it('過去の書類が補う年度（営業利益）は、その書類の出典で入る', () => {
    const older = OLDER({ pl: [{ year: 2023, operatingIncome: -111 }, { year: 2024, operatingIncome: -222 }] });
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST, older], fetchedAt: NOW });
    expect(c.finance.find((y) => y.year === 2023)?.operatingIncome).toMatchObject({ value: -111, source: { docId: 'S100OLD2' } });
    expect(c.reports.map((r) => r.docId)).toEqual(['S100YK2J', 'S100OLD2']);
  });

  it('同じ年度の値が書類で食い違う時は、新しい書類の値を採用し、食い違いを注意に残す', () => {
    const older = OLDER({ pl: [{ year: 2024, netIncome: 999 }] });
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST, older], fetchedAt: NOW });
    const y = latestFacts.pl.find((p) => p.year === 2024)!;
    expect(c.finance.find((x) => x.year === 2024)?.netIncome?.value).toBe(y.netIncome);
    expect(c.issues.join('')).toContain('2024年度');
    expect(c.issues.some((t) => t.includes('S100OLD2') && t.includes('新しい書類の値を採用'))).toBe(true);
  });

  it('直近5期より古い年度は、候補に含めない', () => {
    const older = OLDER({ pl: [{ year: 2019, revenue: 1 }] }, 'S100OLD9', '2020-03-31');
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST, older], fetchedAt: NOW });
    expect(c.finance.map((y) => y.year)).not.toContain(2019);
  });

  it('決算期の月日が報告書ごとに違う時は、注意に残す（3期を2年おきに読むのは正常）', () => {
    const older = OLDER({}, 'S100ODD', '2023-06-30');
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST, older], fetchedAt: NOW });
    expect(c.issues.join('')).toContain('決算期の月日が報告書ごとに異なる');
    const sameMonth = buildMultiYearCandidate({ filer: FILER, reports: [LATEST, OLDER({}, 'S100OK', '2022-03-31')], fetchedAt: NOW });
    expect(sameMonth.issues.join('')).not.toContain('決算期の月日');
  });

  it('百万円単位の丸めの差（100万円以内）は、修正とみなさず、その年度の報告書の値を採る', () => {
    const latestRev = latestFacts.pl.find((p) => p.year === 2022)!.revenue!;
    const own = OLDER({ pl: [{ year: 2022, revenue: latestRev + 360_000 }] }, 'S100OWN22', '2022-03-31');
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST, own], fetchedAt: NOW });
    expect(c.finance.find((y) => y.year === 2022)?.revenue).toMatchObject({ value: latestRev + 360_000, source: { docId: 'S100OWN22' } });
    expect(c.issues.join('')).not.toContain('2022年度');
  });

  it('丸めを超える差は、後の書類の値（修正）を採り、理由を注意に残す', () => {
    const latestRev = latestFacts.pl.find((p) => p.year === 2022)!.revenue!;
    const own = OLDER({ pl: [{ year: 2022, revenue: latestRev + 5_000_000_000 }] }, 'S100OWN22B', '2022-03-31');
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST, own], fetchedAt: NOW });
    expect(c.finance.find((y) => y.year === 2022)?.revenue).toMatchObject({ value: latestRev, source: { docId: 'S100YK2J' } });
    expect(c.issues.join('')).toContain('修正（再表示）の可能性');
  });
});

describe('企業情報と業種・セグメント', () => {
  it('業種は、EDINETの提出者業種を業種区分に対応させ、その旨を注意に残す', () => {
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST], fetchedAt: NOW });
    expect(c.profileExtra.industry?.value).toBe('manufacturing');
    expect(c.issues.join('')).toContain('提出者業種「金属製品」を、業種区分に対応させた');
  });

  it('対応表に無い業種は、業種を埋めず、未入力と注意に残す', () => {
    const c = buildMultiYearCandidate({ filer: { ...FILER, industryName: '未知の業種' }, reports: [LATEST], fetchedAt: NOW });
    expect(c.profileExtra.industry).toBeUndefined();
    expect(c.issues.join('')).toContain('対応させられないため未入力');
  });

  it('所在地・従業員数・事業内容は、直近の書類の記載のまま。セグメントは名前と値を持つ', () => {
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST], fetchedAt: NOW });
    expect(c.profileExtra.location?.value).toBe('埼玉県さいたま市北区吉野町２丁目275番地');
    expect(c.profileExtra.employees?.value).toBe(189);
    expect(c.profileExtra.businessContent?.value).toContain('日本製罐株式会社）及び子会社１社');
    expect(c.segments?.items.map((i) => i.name)).toEqual(['金属缶製造販売事業', '不動産賃貸事業']);
    expect(c.segments?.items[0]).toMatchObject({ sales: 11278329000, operatingIncome: -391504000 });
  });

  it('提出者名と証券コード（東証の4桁）は、一覧の値を使う', () => {
    const c = buildMultiYearCandidate({ filer: FILER, reports: [LATEST], fetchedAt: NOW });
    expect(c.profile.fields.ticker?.value).toBe('5905');
    expect(c.profile.fields.companyName?.value).toBe('日本製罐株式会社');
    expect(c.profile.fields.fiscalYearEnd?.value).toBe('3');
  });
});
