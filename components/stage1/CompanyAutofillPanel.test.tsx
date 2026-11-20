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
const { useCeoChatStore } = require('@/store/ceoChatStore') as typeof import('@/store/ceoChatStore');
const { buildFilingCandidate } = require('@/lib/autofill/filingCandidates') as typeof import('@/lib/autofill/filingCandidates');
const { parseEdinetCsv } = require('@/lib/autofill/edinetZip') as typeof import('@/lib/autofill/edinetZip');
const { extractFacts } = require('@/lib/autofill/xbrlFacts') as typeof import('@/lib/autofill/xbrlFacts');
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

const APPROVE = '承認して反映・保存';

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
const mockSave = jest.fn();

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
  mockSave.mockReset();
  mockSave.mockResolvedValue({ ok: true, revision: 357 });
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
    dirty: false,
    saveStrategyData: mockSave,
  });
  useAutofillStore.setState({ pending: null });
  useCeoChatStore.setState({ ownerKey: null, messages: [], pending: false });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function fetchFor(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/例：日本製罐/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '候補を取得' }));
  await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
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
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('承認すると、既存の入力処理で反映してから保存し、保存できたことを確認して完了と表示する（原資料の値）', async () => {
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(screen.getByText('反映し、保存しました')).toBeTruthy());
    expect(mockSave).toHaveBeenCalledWith({ reason: 'stage1:autofill-approve' });
    const s = useStrategyStore.getState();
    expect(s.companyName).toBe('日本製罐株式会社');
    expect(s.ticker).toBe('5905');
    expect(s.industry).toBe('manufacturing');
    expect(s.location).toBe('埼玉県さいたま市北区吉野町２丁目275番地');
    expect(s.employees).toBe('189');
    const y2026 = (s.financePL as any[]).find((r) => r.year === 2026);
    expect(y2026).toMatchObject({ revenue: 11442246000, operatingIncome: -307863000, netIncome: -346736000 });
    expect((s.financeBS as any[]).find((r) => r.year === 2026)).toMatchObject({ totalAssets: 12975874000, netAssets: 4856436000 });
    expect((s.businessSegments ?? []).map((b) => [b.name, b.revenue, b.profit])).toEqual([
      ['金属缶製造販売事業', 11278, -392],
      ['不動産賃貸事業', 164, 84],
    ]);
  });

  it('保存できなかったら、完了と表示せず、全体保存を案内する', async () => {
    mockSave.mockResolvedValue({ ok: false, reason: 'api_error' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('保存できませんでした'));
    expect(screen.getByRole('alert').textContent).toContain('全体保存');
    expect(screen.queryByText('反映し、保存しました')).toBeNull();
    expect(useStrategyStore.getState().companyName).toBe('日本製罐株式会社');
  });

  it('ほかに未保存の変更があるときは、反映も保存もしない', async () => {
    setStore({ dirty: true });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    expect(screen.getByRole('alert').textContent).toContain('未保存の変更があるため');
    expect(mockSave).not.toHaveBeenCalled();
    expect(useStrategyStore.getState().companyName).toBe('');
  });

  it('登録済みと同じ会社名は変えず、未入力の証券コードだけ反映する（上書きの選択は出ない）', async () => {
    setStore({ companyName: '日本製罐株式会社' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    expect(screen.queryByRole('checkbox', { name: /上書き（会社名）/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(useStrategyStore.getState().ticker).toBe('5905');
  });

  it('登録済みと違う値は、上書きを選んだ時だけ反映する', async () => {
    setStore({ companyName: '日本製罐株式会社', location: '東京都千代田区' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    const over = screen.getByRole('checkbox', { name: '上書き（所在地）' }) as HTMLInputElement;
    expect(over.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(useStrategyStore.getState().location).toBe('東京都千代田区');
  });

  it('上書きを選ぶと、登録済みと違う所在地を取得した値で置き換える', async () => {
    setStore({ companyName: '日本製罐株式会社', location: '東京都千代田区' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    fireEvent.click(screen.getByRole('checkbox', { name: '上書き（所在地）' }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(useStrategyStore.getState().location).toBe('埼玉県さいたま市北区吉野町２丁目275番地');
  });

  it('完了後、AI経営コンサルタントのチャットに、反映・残した・未取得の項目を報告する', async () => {
    setStore({ companyName: '日本製罐株式会社', location: '東京都千代田区' });
    useCeoChatStore.setState({ ownerKey: 'owner-1', messages: [], pending: false });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(useCeoChatStore.getState().messages.length).toBe(1));
    const content = useCeoChatStore.getState().messages[0].content;
    expect(content).toContain('「日本製罐株式会社」の情報を反映し、保存しました。');
    expect(content).toContain('反映：');
    expect(content).toContain('財務：');
    expect(content).toContain('登録済みのため変えていない企業情報：所在地');
    expect(content).toContain('未取得（推測で補っていません）：');
    expect(content).toContain('次の作業：');
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
    expect(screen.queryByRole('button', { name: APPROVE })).toBeNull();
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
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
  });

  it('AI経営コンサルタントが作った候補は、入力欄で確認して承認する（この画面からは取得しない）', async () => {
    useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: CANDIDATE } });
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useStrategyStore.getState().companyName).toBe('');
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(useStrategyStore.getState().companyName).toBe('日本製罐株式会社');
  });

  it('取得から反映までの間に企業が切り替わったら、反映せず、取り直しを求める', async () => {
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    act(() => setStore({ companyId: 'co-b', strategyId: 'st-b' }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    expect(useStrategyStore.getState().companyName).toBe('');
    expect(screen.getByRole('alert').textContent).toContain('企業が切り替わったため');
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('公開情報・添付資料からの候補（承認の前に、企業と円単位を確認する）', () => {
  const { buildWebProfileCandidate, buildDocumentCandidate } = require('@/lib/autofill/publicCandidate') as typeof import('@/lib/autofill/publicCandidate');
  const DOC_CONFIRM = /金額が円単位で記載されていることを確認しました/;

  it('添付資料の候補は、登録中の企業と円単位を確認するまで承認できず、確認後に反映・保存する', async () => {
    const doc = buildDocumentCandidate({
      profiles: [],
      fetchedAt: 'now',
      candidates: [{ kind: 'companyPL', year: 2025, source: 'FY2025.xlsx', confidence: 0.9, fields: { revenue: 1000000, operatingIncome: 100000 } }],
    });
    if (doc.status !== 'FOUND') throw new Error('expected FOUND');
    useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: doc.candidate } });
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    expect((screen.getByRole('button', { name: APPROVE }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: DOC_CONFIRM }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const y2025 = (useStrategyStore.getState().financePL as any[]).find((r) => r.year === 2025);
    expect(y2025).toMatchObject({ revenue: 1000000, operatingIncome: 100000 });
  });

  it('公開情報の候補は、出典（URL・確認日）を示し、登録中の企業が空なら確認なしで反映できる', async () => {
    const web = buildWebProfileCandidate({
      query: '株式会社サンプル製作所',
      facts: [{ text: '会社名: 株式会社サンプル製作所', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] }],
      confirmedOn: '2026-11-20',
    });
    if (web.status !== 'FOUND') throw new Error('expected FOUND');
    useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: web.candidate } });
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    expect(screen.queryByRole('checkbox', { name: /異なります/ })).toBeNull();
    expect(screen.getByText(/https:\/\/sample\.co\.jp\/company/)).toBeTruthy();
    expect(screen.getAllByText(/出典未照合/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: APPROVE }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /出典のURLを開き/ }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(useStrategyStore.getState().companyName).toBe('株式会社サンプル製作所');
  });
});

describe('取り違えの防止（登録中の企業と取得対象の企業）', () => {
  it('登録中の企業と取得対象が違うと、確認するまで反映できない', async () => {
    setStore({ companyName: '別の会社株式会社', ticker: '1234' });
    routeFetch();
    render(<CandidatePanel />);
    await fetchFor('日本製罐');
    const approve = screen.getByRole('button', { name: APPROVE }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /異なります。取得対象の企業の情報として反映することを確認しました/ }));
    expect((screen.getByRole('button', { name: APPROVE }) as HTMLButtonElement).disabled).toBe(false);
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

describe('候補の編集（承認前に値を直して、直した値を保存する）', () => {
  it('所在地を直して承認すると、直した値が保存され、編集していない項目の出典は変わらない', async () => {
    const { buildWebProfileCandidate } = require('@/lib/autofill/publicCandidate') as typeof import('@/lib/autofill/publicCandidate');
    const web = buildWebProfileCandidate({
      query: '株式会社サンプル製作所',
      facts: [
        { text: '会社名: 株式会社サンプル製作所', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] },
        { text: '所在地: 東京都千代田区1-1-1', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] },
      ],
      confirmedOn: '2026-11-20',
    });
    if (web.status !== 'FOUND') throw new Error('expected FOUND');
    useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: web.candidate } });
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox', { name: '編集（所在地）' }), { target: { value: '大阪府大阪市北区1-2-3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /出典のURLを開き/ }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(useStrategyStore.getState().location).toBe('大阪府大阪市北区1-2-3');
    expect(useStrategyStore.getState().companyName).toBe('株式会社サンプル製作所');
  });

  it('従業員数に数字以外を入れると、承認を止め、入力し直しを促す', async () => {
    const { buildWebProfileCandidate } = require('@/lib/autofill/publicCandidate') as typeof import('@/lib/autofill/publicCandidate');
    const web = buildWebProfileCandidate({
      query: '株式会社サンプル製作所',
      facts: [
        { text: '会社名: 株式会社サンプル製作所', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] },
        { text: '従業員数: 120名', sources: [{ title: '採用', url: 'https://sample.co.jp/recruit' }] },
      ],
      confirmedOn: '2026-11-20',
    });
    if (web.status !== 'FOUND') throw new Error('expected FOUND');
    useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: web.candidate } });
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox', { name: '編集（従業員数）' }), { target: { value: '多数' } });
    expect((screen.getByRole('button', { name: APPROVE }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('従業員数は1以上の数字で入力してください')).toBeTruthy();
  });
});
