import fs from 'node:fs';
import path from 'node:path';
import { parseEdinetCsv } from './edinetZip';
import { extractFacts } from './xbrlFacts';
import { buildFilingCandidate, planFilingApply, type CurrentFilingProfile } from './filingCandidates';
import { buildApplyReport, formatApplyReportText } from './applyReport';

const FIX = path.join(__dirname, '__fixtures__');
const CANDIDATE = buildFilingCandidate({
  doc: {
    docId: 'S100YK2J',
    secCode: '59050',
    edinetCode: 'E01408',
    filerName: '日本製罐株式会社',
    docTypeCode: '120',
    docDescription: '有価証券報告書',
    periodStart: '2025-04-01',
    periodEnd: '2026-03-31',
    submitDate: '2026-06-25',
    withdrawn: false,
  },
  facts: extractFacts(parseEdinetCsv(fs.readFileSync(path.join(FIX, 'nisshin-s100yk2j-main-subset.tsv'), 'utf8'))),
  fetchedAt: '2026-11-19T00:00:00.000Z',
  amendedFromDocId: null,
});

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

describe('反映結果の報告（反映・残した・未取得）', () => {
  it('反映した項目・登録済みのため残した項目・未取得の項目を分けて返す', () => {
    const plan = planFilingApply({
      current: { ...EMPTY, location: '東京都千代田区' },
      currentFinance: [],
      candidate: CANDIDATE,
      selectedProfile: ['companyName', 'ticker', 'location'],
      overwriteProfile: [],
      selectedYears: [2026],
      overwriteYears: [],
      selectedSegments: false,
      currentSegmentCount: 0,
    });
    const report = buildApplyReport({ plan, candidate: CANDIDATE, missingPeriods: ['2022年3月期'] });
    expect(report.applied).toContain('企業情報：会社名、証券コード');
    expect(report.applied).toContain('財務：2026年度');
    expect(report.kept).toContain('登録済みのため変えていない企業情報：所在地');
    expect(report.unfetched).toContain('業種（東証33業種として区分できず）');
    expect(report.unfetched).toContain('事業セグメント');
    expect(report.unfetched).toContain('2022年3月期の有価証券報告書');
  });

  it('未取得の数値は、年度ごとに名前を付けて示す（0で埋めたものとは扱わない）', () => {
    const plan = planFilingApply({
      current: EMPTY,
      currentFinance: [],
      candidate: CANDIDATE,
      selectedProfile: [],
      overwriteProfile: [],
      selectedYears: [],
      overwriteYears: [],
      selectedSegments: false,
      currentSegmentCount: 0,
    });
    const report = buildApplyReport({ plan, candidate: CANDIDATE, missingPeriods: [] });
    expect(report.applied).toEqual([]);
    expect(report.unfetched).toContain('営業利益（2022・2023・2024年度）');
  });

  it('チャット向けの文章は、反映・残した・未取得と次の作業を含む', () => {
    const text = formatApplyReportText({
      companyName: '日本製罐株式会社',
      report: { applied: ['企業情報：会社名'], kept: ['登録済みのため変えていない企業情報：所在地'], unfetched: ['事業セグメント'] },
    });
    expect(text.split('\n')).toEqual([
      '「日本製罐株式会社」の情報を反映し、保存しました。',
      '反映：企業情報：会社名',
      '登録済みのため変えていない企業情報：所在地',
      '未取得（推測で補っていません）：事業セグメント',
      '次の作業：STAGE1の財務の数値と事業セグメントの名称を確認してください。内容に問題がなければ、STAGE2（戦略の問い）へ進めます。',
    ]);
  });

  it('何も変えなかった時は、その旨を書く', () => {
    const text = formatApplyReportText({ companyName: '社', report: { applied: [], kept: [], unfetched: [] } });
    expect(text).toContain('反映：変更した項目はありません（すべて登録済みと同じ）');
    expect(text).not.toContain('未取得');
  });
});
