/**
 * @jest-environment jsdom
 */
import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetSession = jest.fn();
jest.mock('@/utils/supabase/client', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const CandidatePanel = require('./CompanyAutofillPanel').default as typeof import('./CompanyAutofillPanel').default;
const { useStrategyStore } = require('@/store/strategyStore') as typeof import('@/store/strategyStore');
const { useAutofillStore } = require('@/lib/autofill/autofillStore') as typeof import('@/lib/autofill/autofillStore');
const { parseEdinetCsv } = require('@/lib/autofill/edinetZip') as typeof import('@/lib/autofill/edinetZip');
const { extractFacts } = require('@/lib/autofill/xbrlFacts') as typeof import('@/lib/autofill/xbrlFacts');
const { buildFilingCandidate } = require('@/lib/autofill/filingCandidates') as typeof import('@/lib/autofill/filingCandidates');

// 日本製罐（S100YK2J）の実データ（原資料の抽出結果）から作った候補
const FIX = path.join(__dirname, '..', '..', 'lib', 'autofill', '__fixtures__', 'nisshin-s100yk2j-main-subset.tsv');
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
  facts: extractFacts(parseEdinetCsv(fs.readFileSync(FIX, 'utf8'))),
  fetchedAt: '2026-11-19T00:00:00.000Z',
  amendedFromDocId: null,
});

const mockFetch = jest.fn();

function setStore(over: Record<string, unknown>) {
  useStrategyStore.setState({ companyId: 'co-a', strategyId: 'st-a', loaded: true, ...over } as any);
}

function respondWith(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  setStore({ companyName: '', ticker: '', fiscalYearEnd: '', isListed: undefined, location: '', employees: '', businessContent: '', financePL: [], financeBS: [] });
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
  it('候補の取得は、入力欄（ストア）を変えない。取得は入口のAPIに会社IDと戦略IDを付けて1回だけ行う', async () => {
    mockFetch.mockResolvedValue(respondWith({ status: 'FOUND', companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', scannedDays: 54, candidate: CANDIDATE }));
    global.fetch = mockFetch as unknown as typeof fetch;
    render(<CandidatePanel />);
    await fetchFor('日本製罐の基本情報を入力して');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toBe('/api/stage1/autofill/plan');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ companyId: 'co-a', strategyId: 'st-a', text: '日本製罐の基本情報を入力して' });
    expect(useStrategyStore.getState().companyName).toBe('');
    expect(useStrategyStore.getState().financePL).toEqual([]);
  });

  it('承認すると、選んだ企業情報を既存の入力処理で反映し、財務は年度ごとに書き込む（原資料の値）', async () => {
    mockFetch.mockResolvedValue(respondWith({ status: 'FOUND', companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', scannedDays: 54, candidate: CANDIDATE }));
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    const s = useStrategyStore.getState();
    expect(s.companyName).toBe('日本製罐株式会社');
    expect(s.ticker).toBe('5905');
    expect(s.location).toBe('埼玉県さいたま市北区吉野町２丁目275番地');
    expect(s.employees).toBe('189');
    expect(s.dirty).toBe(true);
    const y2026 = (s.financePL as any[]).find((r) => r.year === 2026);
    expect(y2026).toMatchObject({ revenue: 11442246000, operatingIncome: -307863000, netIncome: -346736000 });
    const b2026 = (s.financeBS as any[]).find((r) => r.year === 2026);
    expect(b2026).toMatchObject({ totalAssets: 12975874000, netAssets: 4856436000 });
  });

  it('入力済みの会社名は、上書きを選ばない限り変えない', async () => {
    setStore({ companyName: '既存の社名' });
    mockFetch.mockResolvedValue(respondWith({ status: 'FOUND', companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', scannedDays: 54, candidate: CANDIDATE }));
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    expect((screen.getByRole('checkbox', { name: /会社名/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().companyName).toBe('既存の社名');
    expect(useStrategyStore.getState().ticker).toBe('5905');
  });

  it('取得から反映までの間に企業が切り替わったら、反映せず、取り直しを求める', async () => {
    mockFetch.mockResolvedValue(respondWith({ status: 'FOUND', companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', scannedDays: 54, candidate: CANDIDATE }));
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    act(() => setStore({ companyId: 'co-b', strategyId: 'st-b' }));
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().companyName).toBe('');
    expect(screen.getByRole('alert').textContent).toContain('企業が切り替わったため');
  });

  it('同じ名前の会社が複数あるときは、推測せず、証券コードでの指定を求める', async () => {
    mockFetch.mockResolvedValue(respondWith({ status: 'AMBIGUOUS', candidates: [{ name: '東洋製罐株式会社', secCode: '5901', edinetCode: 'E1' }, { name: '東洋製缶グループ株式会社', secCode: '5901', edinetCode: 'E2' }] }));
    render(<CandidatePanel />);
    fireEvent.change(screen.getByPlaceholderText(/例：日本製罐/), { target: { value: '東洋' } });
    fireEvent.click(screen.getByRole('button', { name: '候補を取得' }));
    await waitFor(() => expect(screen.getByText(/証券コード（4桁）で指定してください/)).toBeTruthy());
    expect(screen.getByText(/東洋製罐株式会社/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '承認して反映' })).toBeNull();
    expect(useStrategyStore.getState().companyName).toBe('');
  });

  it('AI経営コンサルタントが作った候補は、入力欄で確認して承認する（チャットからは反映しない）', async () => {
    useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: CANDIDATE } });
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: '承認して反映' })).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useStrategyStore.getState().companyName).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().companyName).toBe('日本製罐株式会社');
  });
});
