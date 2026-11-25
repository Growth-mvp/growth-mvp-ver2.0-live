import type { Stage1ImportCandidate } from '@/types/strategy';
import { buildDocumentCandidate, buildWebProfileCandidate, type WebFact } from './publicCandidate';

const NOW = '2026-11-20';
const COMPANY = { title: '会社概要', url: 'https://sample.co.jp/company' };
const RECRUIT = { title: '採用情報', url: 'https://sample.co.jp/recruit' };

const facts: WebFact[] = [
  { text: '会社名: 株式会社サンプル製作所', sources: [COMPANY] },
  { text: '所在地: 東京都千代田区1-1-1', sources: [COMPANY] },
  { text: '従業員数: 約120名（2025年3月末時点）', sources: [RECRUIT] },
  { text: '業種: 機械', sources: [COMPANY] },
  { text: '事業内容: 産業用機械の設計・製造', sources: [COMPANY] },
  { text: '主要商品・サービス: 包装機械', sources: [COMPANY] },
  { text: '代表者: 山田太郎', sources: [COMPANY] },
  { text: '所在地: 大阪府大阪市', sources: [RECRUIT] },
];

describe('公開情報から非上場企業の基本情報の候補を作る', () => {
  it('依頼の会社名と一致する時だけ、出典つきの項目を候補にする', () => {
    const r = buildWebProfileCandidate({ query: '株式会社サンプル製作所', facts, confirmedOn: NOW });
    expect(r.status).toBe('FOUND');
    if (r.status !== 'FOUND') return;
    const c = r.candidate;
    expect(c.origin).toBe('WEB');
    expect(c.filer).toEqual({ name: '株式会社サンプル製作所', secCode: null, edinetCode: null });
    expect(c.profile.fields.companyName?.value).toBe('株式会社サンプル製作所');
    expect(c.profileExtra.location).toMatchObject({
      value: '東京都千代田区1-1-1',
      source: { source: 'WEB', url: COMPANY.url, title: COMPANY.title, confirmedOn: NOW },
    });
    expect(c.profileExtra.employees?.value).toBe(120);
    expect(c.profileExtra.employees?.source).toMatchObject({ source: 'WEB', url: RECRUIT.url });
    expect(c.profileExtra.industry?.value).toBe('manufacturing');
    expect(c.profileExtra.businessContent?.value).toBe('産業用機械の設計・製造\n主要商品・サービス：包装機械');
    expect(c.finance).toEqual([]);
    expect(c.sources.map((s) => (s.source === 'WEB' ? s.url : ''))).toEqual([COMPANY.url, RECRUIT.url]);
  });

  it('同じ項目の記載が出典どうしで違う時は、先頭の値を使い、要確認と示す', () => {
    const r = buildWebProfileCandidate({ query: '株式会社サンプル製作所', facts, confirmedOn: NOW });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    expect(r.candidate.profileExtra.location?.value).toBe('東京都千代田区1-1-1');
    expect(r.candidate.issues.some((t) => t.includes('所在地の出典どうしで記載が違う'))).toBe(true);
  });

  it('会社名が依頼と一致しない、または会社名の記載が無い時は候補を作らない', () => {
    expect(buildWebProfileCandidate({ query: '別の会社', facts, confirmedOn: NOW }).status).toBe('NOT_CONFIRMED');
    const noName = facts.filter((f) => !f.text.startsWith('会社名'));
    expect(buildWebProfileCandidate({ query: '株式会社サンプル製作所', facts: noName, confirmedOn: NOW }).status).toBe('NOT_CONFIRMED');
  });

  it('STAGE1の業種区分に対応しない業種・人数として読めない従業員数は、未入力のままにする', () => {
    const r = buildWebProfileCandidate({
      query: '株式会社サンプル製作所',
      facts: [
        { text: '会社名: 株式会社サンプル製作所', sources: [COMPANY] },
        { text: '業種: 製造業', sources: [COMPANY] },
        { text: '従業員数: 多数', sources: [COMPANY] },
      ],
      confirmedOn: NOW,
    });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    expect(r.candidate.profileExtra.industry).toBeUndefined();
    expect(r.candidate.profileExtra.employees).toBeUndefined();
    expect(r.candidate.issues.some((t) => t.includes('業種「製造業」'))).toBe(true);
    expect(r.candidate.issues.some((t) => t.includes('従業員数は人数として読み取れなかった'))).toBe(true);
  });
});

const money = (over: Partial<Stage1ImportCandidate> & Pick<Stage1ImportCandidate, 'kind' | 'year' | 'fields'>): Stage1ImportCandidate => ({
  confidence: 0.9,
  source: 'FY2025.xlsx',
  ...over,
});

const build = (candidates: Stage1ImportCandidate[], profiles: Parameters<typeof buildDocumentCandidate>[0]['profiles'] = []) =>
  buildDocumentCandidate({ candidates, profiles, fetchedAt: '2026-11-20T00:00:00.000Z' });

describe('資料から候補を作る（単位の換算・連結単体・事業別財務）', () => {
  it('単位の表記が無い資料は円と仮定し、承認画面で円単位を確認させる', () => {
    const r = build([
      money({ kind: 'companyPL', year: 2025, fields: { revenue: 1000000, operatingIncome: 100000 } }),
      money({ kind: 'companyBS', year: 2025, fields: { totalAssets: 5000000, netAssets: 2000000 } }),
    ]);
    expect(r.status).toBe('FOUND');
    if (r.status !== 'FOUND') return;
    const c = r.candidate;
    expect(c.origin).toBe('DOCUMENT');
    expect(c.fiscalYear).toBe(2025);
    expect(c.finance[0]).toMatchObject({
      year: 2025,
      revenue: { value: 1000000, fiscalYear: 2025, source: { source: 'DOCUMENT', fileName: 'FY2025.xlsx' }, consolidation: 'UNKNOWN' },
      operatingIncome: { value: 100000 },
      totalAssets: { value: 5000000 },
      netAssets: { value: 2000000 },
    });
    expect(c.issues.some((t) => t.includes('FY2025.xlsx') && t.includes('円単位で記載されていることを承認前に確認'))).toBe(true);
  });

  it('千円・百万円と明示された金額は、円に換算して取り込む', () => {
    const r = build([
      money({ kind: 'companyPL', year: 2025, source: '損益計算書.pdf', sheetUnit: '千円', fields: { revenue: 1200 } }),
      money({ kind: 'companyBS', year: 2025, source: '貸借対照表.pdf', fieldUnits: { totalAssets: '百万円' }, fields: { totalAssets: 5 } }),
    ]);
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    expect(r.candidate.finance[0].revenue?.value).toBe(1_200_000);
    expect(r.candidate.finance[0].totalAssets?.value).toBe(5_000_000);
    expect(r.candidate.issues.some((t) => t.includes('損益計算書.pdf（千円→円）'))).toBe(true);
    expect(r.candidate.issues.some((t) => t.includes('金額の単位が明示されていない'))).toBe(false);
  });

  it('対応していない単位（億円など）の金額は取り込まず、理由を示す', () => {
    const r = build([money({ kind: 'companyPL', year: 2025, source: 'oku.pdf', sheetUnit: '億円', fields: { revenue: 3 } })]);
    expect(r.status).toBe('NOT_CONFIRMED');
    if (r.status !== 'NOT_CONFIRMED') return;
    expect(r.message).toContain('取り込める');
  });

  it('同じ年度の値が別の資料にある時は、先に読んだ値を使い、要確認と示す', () => {
    const r = build([
      money({ kind: 'companyPL', year: 2025, source: 'a.csv', fields: { revenue: 100 } }),
      money({ kind: 'companyPL', year: 2025, source: 'b.csv', fields: { revenue: 999 } }),
    ]);
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    expect(r.candidate.finance[0].revenue?.value).toBe(100);
    expect(r.candidate.issues.some((t) => t.includes('同じ年度の金額が複数の資料'))).toBe(true);
  });

  it('年度の無い候補や、金額の項目が無い候補からは財務を作らない', () => {
    const r = build([money({ kind: 'companyPL', year: undefined, fields: { revenue: 1 } }), money({ kind: 'companyBS', year: 2025, fields: {} })]);
    expect(r.status).toBe('NOT_CONFIRMED');
  });

  it('連結と書かれた取込元は連結、名称に区別が無い取込元は未確認にする', () => {
    const r = build([
      money({ kind: 'companyPL', year: 2025, source: '連結損益計算書', fields: { revenue: 10 } }),
      money({ kind: 'companyPL', year: 2024, source: 'PL.csv', fields: { revenue: 9 } }),
    ]);
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    expect(r.candidate.finance.find((y) => y.year === 2025)?.revenue?.consolidation).toBe('CONSOLIDATED');
    expect(r.candidate.finance.find((y) => y.year === 2024)?.revenue?.consolidation).toBe('UNKNOWN');
    expect(r.candidate.issues.some((t) => t.includes('連結・単体は資料の名称から判断できない'))).toBe(true);
  });

  it('事業別の売上・営業利益を、最新年度の事業セグメントとして候補にする（千円は円に換算）', () => {
    const r = build([
      money({ kind: 'segmentPL', year: 2025, segmentName: '金属缶事業', source: 'seg.xlsx', sheetUnit: '千円', fields: { revenue: 500, operatingIncome: 20 } }),
      money({ kind: 'segmentPL', year: 2024, segmentName: '金属缶事業', source: 'seg.xlsx', sheetUnit: '千円', fields: { revenue: 1 } }),
    ]);
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    expect(r.candidate.segments?.periodEnd).toBe('2025');
    expect(r.candidate.segments?.items).toEqual([
      expect.objectContaining({ name: '金属缶事業', memberCode: '金属缶事業', sales: 500_000, operatingIncome: 20_000 }),
    ]);
    expect(r.candidate.segments?.items[0].byYear).toEqual([
      { year: 2024, sales: 1_000, operatingIncome: undefined },
      { year: 2025, sales: 500_000, operatingIncome: 20_000 },
    ]);
  });

  it('会社案内の基本情報（会社名・所在地・従業員数・事業内容）を、資料の記載どおりに候補にする', () => {
    const r = build([], [
      {
        companyName: { value: '株式会社サンプル製作所', where: '会社案内.pdf（1ページ）' },
        location: { value: '東京都千代田区1-1-1', where: '会社案内.pdf（2ページ）' },
        employees: { value: 120, where: '会社案内.pdf（2ページ）' },
        businessContent: { value: '産業用機械の設計・製造', where: '会社案内.pdf（3ページ）' },
      },
    ]);
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    const c = r.candidate;
    expect(c.filer.name).toBe('株式会社サンプル製作所');
    expect(c.profile.fields.companyName).toMatchObject({ value: '株式会社サンプル製作所', source: { source: 'DOCUMENT', fileName: '会社案内.pdf（1ページ）' } });
    expect(c.profileExtra.employees?.value).toBe(120);
    expect(c.profileExtra.businessContent?.value).toBe('産業用機械の設計・製造');
    expect(c.finance).toEqual([]);
  });

  it('基本情報が無く、財務も無い資料からは候補を作らない', () => {
    expect(build([], [{}]).status).toBe('NOT_CONFIRMED');
  });
});
