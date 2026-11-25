import { buildCandidatesFromPdfText, normalizeCandidates } from './candidateBuilder';
import { extractProfileFromPages } from './profileExtract';
import { buildDocumentCandidate } from '@/lib/autofill/publicCandidate';
import { TOKYO_TSUKUBA_FILE as FILE, TOKYO_TSUKUBA_PAGES as PAGES } from '@/lib/autofill/__fixtures__/tokyoTsukubaPages';

function documentCandidate() {
  const candidates = normalizeCandidates(buildCandidatesFromPdfText(PAGES).map((c) => ({ ...c, source: FILE })) as never);
  const profile = extractProfileFromPages(PAGES, FILE);
  const result = buildDocumentCandidate({ candidates, profiles: [profile], fetchedAt: '2026-11-26T00:00:00.000Z' });
  if (result.status !== 'FOUND') throw new Error('expected FOUND');
  return result.candidate;
}

describe('架空企業の財務PDF（千円表記）の読み取り', () => {
  it('会社名・所在地・従業員数を読み、注記付きの従業員数も数値にする', () => {
    const c = documentCandidate();
    expect(c.profile.fields.companyName?.value).toBe('株式会社東つくば地域サービス');
    expect(c.profileExtra.location?.value).toBe('茨城県つくば市');
    expect(c.profileExtra.employees?.value).toBe(15);
  });

  it('全社PLの過去5期を千円から円に換算して読む', () => {
    const c = documentCandidate();
    expect(c.finance.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(c.finance.map((y) => y.revenue?.value)).toEqual([161_000_000, 162_000_000, 166_000_000, 168_500_000, 172_000_000]);
    expect(c.finance.map((y) => y.operatingIncome?.value)).toEqual([6_700_000, 2_800_000, 3_400_000, 3_900_000, 4_500_000]);
  });

  it('最新のBSは基準日（2026年3月31日）の年度だけに入れ、他の年度へ振り分けない', () => {
    const c = documentCandidate();
    const latest = c.finance.find((y) => y.year === 2026);
    expect(latest?.totalAssets?.value).toBe(84_000_000);
    expect(latest?.netAssets?.value).toBe(28_000_000);
    for (const y of c.finance.filter((r) => r.year !== 2026)) {
      expect(y.totalAssets).toBeUndefined();
      expect(y.netAssets).toBeUndefined();
    }
  });

  it('事業別PLの最新期を3事業とも読み、0の値も列がずれずに読む', () => {
    const c = documentCandidate();
    expect(c.segments?.periodEnd).toBe('2026');
    expect(c.segments?.items).toEqual([
      expect.objectContaining({ name: '新聞販売・配達', sales: 122_000_000, operatingIncome: 500_000 }),
      expect.objectContaining({ name: '宅配', sales: 28_000_000, operatingIncome: 2_300_000 }),
      expect.objectContaining({ name: 'フィットネス', sales: 22_000_000, operatingIncome: 1_700_000 }),
    ]);
  });

  it('事業別の行を全社の営業利益として読まない', () => {
    const c = documentCandidate();
    expect(c.finance.find((y) => y.year === 2026)?.operatingIncome?.value).toBe(4_500_000);
  });

  it('千円から円への換算を確認事項として示す', () => {
    const c = documentCandidate();
    expect(c.issues.some((m) => m.includes('千円→円'))).toBe(true);
  });

  it('事業別PLは3事業の過去5期すべてを、円で持つ', () => {
    const c = documentCandidate();
    const fitness = c.segments?.items.find((i) => i.name === 'フィットネス');
    expect(fitness?.byYear).toEqual([
      { year: 2022, sales: 0, operatingIncome: 0 },
      { year: 2023, sales: 4_000_000, operatingIncome: -2_500_000 },
      { year: 2024, sales: 11_000_000, operatingIncome: -1_000_000 },
      { year: 2025, sales: 16_500_000, operatingIncome: 500_000 },
      { year: 2026, sales: 22_000_000, operatingIncome: 1_700_000 },
    ]);
    expect(c.segments?.items.map((i) => i.byYear?.length)).toEqual([5, 5, 5]);
  });

  it('現預金と有利子負債を、基準日の年度の貸借対照表に読む', () => {
    const c = documentCandidate();
    const latest = c.finance.find((y) => y.year === 2026);
    expect(latest?.cash?.value).toBe(12_000_000);
    expect(latest?.interestBearingDebt?.value).toBe(23_000_000);
    expect(c.finance.filter((y) => y.year !== 2026).every((y) => y.cash === undefined && y.interestBearingDebt === undefined)).toBe(true);
  });

  it('事業の概要の節を事業内容として読み、業種は単一の区分に決められないため入れない', () => {
    const c = documentCandidate();
    expect(c.profileExtra.businessContent?.value).toContain('新聞販売・配達事業');
    expect(c.profileExtra.businessContent?.value).toContain('フィットネス事業');
    expect(c.profileExtra.industry).toBeUndefined();
    expect(c.issues.some((m) => m.includes('業種「新聞販売・配達業、宅配事業、フィットネス事業」'))).toBe(true);
  });
});
