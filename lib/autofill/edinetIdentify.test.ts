import type { EdinetDocument } from './companyCandidates';
import {
  findAnnualReportForPeriod,
  fiscalPeriodEnd,
  identifyCompany,
  MAX_IDENTIFY_DAYS,
  normalizeCompanyName,
  parseIdentifyQuery,
  recentPeriodEnds,
  weekdaysDesc,
  windowsByPriority,
} from './edinetIdentify';

// 2026-11-19 12:00 JST
const NOW = Date.parse('2026-11-19T03:00:00Z');

const DOC = (over: Partial<EdinetDocument>): EdinetDocument => ({
  docId: 'S1',
  secCode: '59050',
  edinetCode: 'E01408',
  filerName: '日本製罐株式会社',
  docTypeCode: '120',
  docDescription: '有価証券報告書',
  periodStart: '2025-04-01',
  periodEnd: '2026-03-31',
  submitDate: '2026-06-25 15:00',
  withdrawn: false,
  ...over,
});

function calendar(byDay: Record<string, EdinetDocument[]>) {
  const called: string[] = [];
  const listDocs = async (day: string) => {
    called.push(day);
    return byDay[day] ?? [];
  };
  return { listDocs, called };
}

describe('会社名・証券コードの解析（推測で決めない）', () => {
  it('依頼文から会社名を取り出す（依頼の言い回しは外す）', () => {
    expect(parseIdentifyQuery('日本製罐の基本情報を入力して')).toEqual({ name: '日本製罐' });
    expect(parseIdentifyQuery('丹青社の財務データを取り込んで')).toEqual({ name: '丹青社' });
    expect(parseIdentifyQuery('株式会社丹青社の有価証券報告書を反映して')).toEqual({ name: '丹青社' });
  });

  it('4桁の証券コードがあれば、会社名より優先する', () => {
    expect(parseIdentifyQuery('証券コード5905の基本情報を入力して')).toEqual({ secCode: '5905' });
    expect(parseIdentifyQuery('日本製罐 5905')).toEqual({ secCode: '5905' });
  });

  it('依頼として読み取れない文は、null（自動入力の対象にしない）', () => {
    expect(parseIdentifyQuery('こんにちは')).toBeNull();
    expect(parseIdentifyQuery('')).toBeNull();
  });

  it('会社名の表記ゆれ（株式会社・空白・全角）を吸収する', () => {
    expect(normalizeCompanyName('株式会社 丹青社')).toBe(normalizeCompanyName('丹青社'));
    expect(normalizeCompanyName('ＮＩＨＯＮ　ＳＥＩＫＡＮ')).toBe('nihonseikan');
  });
});

describe('提出日の範囲はシステムが決める（窓の優先順・平日のみ・上限）', () => {
  it('窓は、提出が集中する月（6月→3月→4月…）の順。今日より後の期間は含めない', () => {
    const w = windowsByPriority(NOW);
    expect(w.map((x) => x.month).slice(0, 3)).toEqual([6, 3, 4]);
    const june = w.find((x) => x.month === 6)!;
    expect(june.from.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(june.to.toISOString().slice(0, 10)).toBe('2026-06-30');
    const nov = w.find((x) => x.month === 11)!;
    expect(nov.to.toISOString().slice(0, 10)).toBe('2026-11-19');
  });

  it('平日だけを読む（土日は読まない）', () => {
    const days = weekdaysDesc(new Date('2026-06-01T00:00:00Z'), new Date('2026-06-07T00:00:00Z'));
    expect(days).toEqual(['2026-06-05', '2026-06-04', '2026-06-03', '2026-06-02', '2026-06-01']);
  });
});

describe('会社の特定', () => {
  it('提出の集中する月（6月）で見つかれば、その時点で有価証券報告書を返す（他の月は読まない）', async () => {
    const cal = calendar({ '2026-06-25': [DOC({})] });
    const r = await identifyCompany({ name: '日本製罐' }, { now: NOW, listDocs: cal.listDocs });
    expect(r.status).toBe('FOUND');
    if (r.status !== 'FOUND') return;
    expect(r.filer).toEqual({ name: '日本製罐株式会社', secCode: '5905', edinetCode: 'E01408' });
    expect(r.annualReport.docId).toBe('S1');
    expect(cal.called.every((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))).toBe(true);
    expect(cal.called.some((d) => d.startsWith('2026-03'))).toBe(false);
  });

  it('同じ名前の会社が複数あるなら、推測せず候補の一覧を返す', async () => {
    const cal = calendar({
      '2026-06-10': [DOC({ docId: 'A', filerName: '東洋製罐株式会社', edinetCode: 'E1', secCode: '5901' })],
      '2026-06-11': [DOC({ docId: 'B', filerName: '東洋製缶グループ株式会社', edinetCode: 'E2', secCode: '5901' })],
    });
    const r = await identifyCompany({ name: '東洋' }, { now: NOW, listDocs: cal.listDocs });
    expect(r.status).toBe('AMBIGUOUS');
    if (r.status === 'AMBIGUOUS') expect(r.candidates.map((c) => c.edinetCode)).toEqual(['E2', 'E1']);
  });

  it('訂正報告書は、同じ期の有価証券報告書の提出後に限って確認し、一覧に含める', async () => {
    const cal = calendar({
      '2026-06-25': [DOC({ docId: 'ORIG', submitDate: '2026-06-25 15:00' })],
      '2026-07-02': [DOC({ docId: 'AMEND', docTypeCode: '130', submitDate: '2026-07-02 10:00' })],
    });
    const r = await identifyCompany({ secCode: '5905' }, { now: NOW, listDocs: cal.listDocs });
    expect(r.status).toBe('FOUND');
    if (r.status === 'FOUND') expect(r.amendments.map((d) => d.docId)).toEqual(['AMEND']);
  });

  it('読み取りの上限に達したら、そこで止める（過剰な問い合わせをしない）', async () => {
    const cal = calendar({});
    const r = await identifyCompany({ name: '存在しない会社' }, { now: NOW, listDocs: cal.listDocs });
    expect(r.status).toBe('BUDGET_EXCEEDED');
    expect(cal.called.length).toBe(MAX_IDENTIFY_DAYS);
  });

  it('どの期間にも無ければ NOT_FOUND（上限内で、全期間を読み終えた場合）', async () => {
    const cal = calendar({});
    const r = await identifyCompany({ name: '存在しない会社' }, { now: NOW, listDocs: cal.listDocs });
    expect(['NOT_FOUND', 'BUDGET_EXCEEDED']).toContain(r.status);
  });
});

describe('決算期ごとの有価証券報告書の探索（決算日から窓を決める）', () => {
  // 2026-11-19 12:00 JST
  const NOW2 = Date.parse('2026-11-19T03:00:00Z');
  const ANNUAL2 = (over: Partial<EdinetDocument>): EdinetDocument => DOC({ docId: 'ANNUAL', periodEnd: '2026-03-31', submitDate: '2026-06-25 10:00', ...over });

  it('決算期の終わりから92日以内の、新しい日から読む（締切近くに集中するため）', async () => {
    const cal = calendar({ '2026-06-25': [ANNUAL2({})] });
    const r = await findAnnualReportForPeriod({ edinetCode: 'E01408', periodEnd: '2026-03-31' }, { now: NOW2, listDocs: cal.listDocs });
    expect(r.status).toBe('FOUND');
    expect(cal.called[0]).toBe('2026-07-01');
    if (r.status === 'FOUND') expect(r.annual.docId).toBe('ANNUAL');
  });

  it('同じ会社・同じ決算期の訂正報告書を、提出後の窓で確認する（別の会社の書類は無視）', async () => {
    const cal = calendar({
      '2026-06-25': [ANNUAL2({})],
      '2026-07-02': [ANNUAL2({ docId: 'AMEND', docTypeCode: '130', submitDate: '2026-07-02 10:00' }), ANNUAL2({ docId: 'OTHER', edinetCode: 'E99999', docTypeCode: '130' })],
    });
    const r = await findAnnualReportForPeriod({ edinetCode: 'E01408', periodEnd: '2026-03-31' }, { now: NOW2, listDocs: cal.listDocs });
    expect(r.status === 'FOUND' && r.amendments.map((d) => d.docId)).toEqual(['AMEND']);
  });

  it('決算期がまだ窓に入っていない時は、読まずに NOT_YET_OPEN', async () => {
    const cal = calendar({});
    const r = await findAnnualReportForPeriod({ edinetCode: 'E01408', periodEnd: '2027-03-31' }, { now: NOW2, listDocs: cal.listDocs });
    expect(r.status).toBe('NOT_YET_OPEN');
    expect(cal.called).toHaveLength(0);
  });

  it('上限に達したら、そこで止める（BUDGET_EXCEEDED）', async () => {
    const cal = calendar({});
    const r = await findAnnualReportForPeriod({ edinetCode: 'E01408', periodEnd: '2026-03-31' }, { now: NOW2, listDocs: cal.listDocs, maxDays: 5 });
    expect(r.status).toBe('BUDGET_EXCEEDED');
    expect(cal.called).toHaveLength(5);
  });

  it('決算日から、期の終わりの日付を作る（存在しない日は月末）', () => {
    expect(fiscalPeriodEnd(2026, 3, 31)).toBe('2026-03-31');
    expect(fiscalPeriodEnd(2026, 2, 31)).toBe('2026-02-28');
    expect(fiscalPeriodEnd(2026, 1, null)).toBe('2026-01-31');
  });

  it('直近の決算期と、その2年・4年前（5期分の読む対象）を返す。窓がまだ開いていない期は除く', () => {
    expect(recentPeriodEnds({ month: 3, day: 31 }, NOW2)).toEqual(['2026-03-31', '2024-03-31', '2022-03-31']);
    expect(recentPeriodEnds({ month: 1, day: 31 }, NOW2)).toEqual(['2026-01-31', '2024-01-31', '2022-01-31']);
    expect(recentPeriodEnds({ month: 12, day: 31 }, NOW2)).toEqual(['2025-12-31', '2023-12-31', '2021-12-31']);
  });
});
