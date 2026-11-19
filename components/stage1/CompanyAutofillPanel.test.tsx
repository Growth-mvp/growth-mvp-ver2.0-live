/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { identifyFound, jsonRes, reportFound, NISSHIN_FILER } from '../../lib/autofill/__fixtures__/pipelineResponses';

const mockGetSession = jest.fn();
jest.mock('@/utils/supabase/client', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const CandidatePanel = require('./CompanyAutofillPanel').default as typeof import('./CompanyAutofillPanel').default;
const { differsFromRegistered } = require('./CompanyAutofillPanel') as typeof import('./CompanyAutofillPanel');
const { useStrategyStore } = require('@/store/strategyStore') as typeof import('@/store/strategyStore');
const { useAutofillStore } = require('@/lib/autofill/autofillStore') as typeof import('@/lib/autofill/autofillStore');
const { buildFilingCandidate } = require('@/lib/autofill/filingCandidates') as typeof import('@/lib/autofill/filingCandidates');
const { parseEdinetCsv } = require('@/lib/autofill/edinetZip') as typeof import('@/lib/autofill/edinetZip');
const { extractFacts } = require('@/lib/autofill/xbrlFacts') as typeof import('@/lib/autofill/xbrlFacts');
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

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
  facts: extractFacts(parseEdinetCsv(fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'autofill', '__fixtures__', 'nisshin-s100yk2j-main-subset.tsv'), 'utf8'))),
  fetchedAt: '2026-11-19T00:00:00.000Z',
  amendedFromDocId: null,
});

const mockFetch = jest.fn();

function setStore(over: Record<string, unknown>) {
  useStrategyStore.setState({ companyId: 'co-a', strategyId: 'st-a', loaded: true, ...over } as any);
}

/** 入口（会社の特定・決算期ごとの報告書）の応答を返す */
function routeFetch(overrides: { identify?: () => unknown; report?: () => Promise<unknown> | unknown } = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/identify')) return jsonRes(overrides.identify ? overrides.identify() : identifyFound());
    if (String(url).endsWith('/report')) return jsonRes(overrides.report ? await overrides.report() : reportFound());
    throw new Error(`unexpected url ${url}`);
  });
}

beforeEach(() => {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  setStore({
    companyName: '',
    ticker: '',
    fiscalYearEnd: '',
    isListed: undefined,
    location: '',
    employees: '',
    businessContent: '',
    industry: '',
    businessSegments: [],
    financePL: [],
    financeBS: [],
  });
  useAutofillStore.setState({ pending: null });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function fetchFor(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/例：日本製罐/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '候補を取得' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '承認して反映' })).toBeTruthy());
}

describe('公開資料からの基本情報の候補（承認するまで反映しない）', () => {
  it('候補の取得は、入力欄（ストア）を変えず、会社の特定→決算期ごとの報告書の順に、会社IDと戦略IDを付けて呼ぶ', async () => {
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐の基本情報を入力して');
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(['/api/stage1/autofill/identify', '/api/stage1/autofill/report']);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ companyId: 'co-a', strategyId: 'st-a', text: '日本製罐の基本情報を入力して' });
    expect(useStrategyStore.getState().companyName).toBe('');
    expect(useStrategyStore.getState().financePL).toEqual([]);
  });

  it('承認すると、企業情報・業種・財務・事業セグメントを既存の入力処理で反映する（原資料の値）', async () => {
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    const s = useStrategyStore.getState();
    expect(s.companyName).toBe('日本製罐株式会社');
    expect(s.ticker).toBe('5905');
    expect(s.industry).toBe('manufacturing');
    expect(s.location).toBe('埼玉県さいたま市北区吉野町２丁目275番地');
    expect(s.employees).toBe('189');
    expect(s.dirty).toBe(true);
    const y2026 = (s.financePL as any[]).find((r) => r.year === 2026);
    expect(y2026).toMatchObject({ revenue: 11442246000, operatingIncome: -307863000, netIncome: -346736000 });
    expect((s.financeBS as any[]).find((r) => r.year === 2026)).toMatchObject({ totalAssets: 12975874000, netAssets: 4856436000 });
    expect((s.businessSegments ?? []).map((b) => [b.name, b.revenue, b.profit])).toEqual([
      ['金属缶製造販売事業', 11278, -392],
      ['不動産賃貸事業', 164, 84],
    ]);
  });

  it('入力済みの会社名は、上書きを選ばない限り変えない', async () => {
    setStore({ companyName: '日本製罐株式会社' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    expect((screen.getByRole('checkbox', { name: /会社名/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().ticker).toBe('5905');
  });

  it('取得から反映までの間に企業が切り替わったら、反映せず、取り直しを求める', async () => {
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    act(() => setStore({ companyId: 'co-b', strategyId: 'st-b' }));
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().companyName).toBe('');
    expect(screen.getByRole('alert').textContent).toContain('企業が切り替わったため');
  });

  it('同じ名前の会社が複数あるときは、推測せず、証券コードでの指定を求める', async () => {
    routeFetch({
      identify: () => ({
        status: 'AMBIGUOUS',
        candidates: [
          { name: '東洋製罐グループホールディングス株式会社', secCode: '5901', edinetCode: 'E1', address: '東京都' },
          { name: '東洋水産株式会社', secCode: '2875', edinetCode: 'E2', address: '東京都' },
        ],
      }),
    });
    render(<CandidatePanel />);
    fireEvent.change(screen.getByPlaceholderText(/例：日本製罐/), { target: { value: '東洋' } });
    fireEvent.click(screen.getByRole('button', { name: '候補を取得' }));
    await waitFor(() => expect(screen.getByText(/証券コード（4桁）を付けて/)).toBeTruthy());
    expect(screen.getByText(/東洋水産株式会社/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '承認して反映' })).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('取得中は、進行状況（何を確認しているか）を表示する', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    routeFetch({ report: async () => { await gate; return reportFound(); } });
    render(<CandidatePanel />);
    fireEvent.change(screen.getByPlaceholderText(/例：日本製罐/), { target: { value: '日本製罐' } });
    fireEvent.click(screen.getByRole('button', { name: '候補を取得' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('有価証券報告書を確認しています'));
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('button', { name: '承認して反映' })).toBeTruthy());
  });

  it('AI経営コンサルタントが作った候補は、入力欄で確認して承認する（この画面からは取得しない）', async () => {
    useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: CANDIDATE } });
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: '承認して反映' })).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useStrategyStore.getState().companyName).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().companyName).toBe('日本製罐株式会社');
  });
});

describe('取り違えの防止（登録中の企業と取得対象の企業）', () => {
  it('登録中の企業と取得対象が違うと、確認するまで反映できない', async () => {
    setStore({ companyName: '別の会社株式会社', ticker: '1234' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    const approve = screen.getByRole('button', { name: '承認して反映' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /異なります。取得対象の企業の情報として反映することを確認しました/ }));
    expect((screen.getByRole('button', { name: '承認して反映' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('登録中の企業が同じなら、確認は不要', async () => {
    setStore({ companyName: '日本製罐株式会社', ticker: '5905' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    expect(screen.queryByRole('checkbox', { name: /異なります/ })).toBeNull();
  });

  it('差の判定：登録中の情報が空なら、違いとしない。表記ゆれ（株式会社）は同じ企業とみなす', () => {
    expect(differsFromRegistered('', '', CANDIDATE)).toBe(false);
    expect(differsFromRegistered('日本製罐', '5905', CANDIDATE)).toBe(false);
    expect(differsFromRegistered('別の会社', '', CANDIDATE)).toBe(true);
    expect(differsFromRegistered('', '1234', CANDIDATE)).toBe(true);
    expect(NISSHIN_FILER.secCode).toBe('5905');
  });
});
