/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetSession = jest.fn();
jest.mock('@/utils/supabase/client', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const CandidatePanel = require('./CompanyAutofillPanel').default as typeof import('./CompanyAutofillPanel').default;
const { useStrategyStore } = require('@/store/strategyStore') as typeof import('@/store/strategyStore');

const ROW = {
  docID: 'S100TEST',
  secCode: '59050',
  filerName: '日本製罐株式会社',
  docTypeCode: '120',
  docDescription: '有価証券報告書',
  periodEnd: '2026-03-31',
  withdrawalStatus: '0',
};

function setStore(over: Record<string, unknown>) {
  useStrategyStore.setState({ companyId: 'co-a', strategyId: 'st-a', ...over } as any);
}

function respondWith(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
  global.fetch = jest.fn(async () => respondWith({ companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', matches: [], candidate: null })) as unknown as typeof fetch;
  setStore({ companyName: '', ticker: '', fiscalYearEnd: '', isListed: undefined });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function fetchCandidates(code = '5905') {
  fireEvent.change(screen.getByLabelText('証券コード'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: '候補を取得' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '承認して反映' })).toBeTruthy());
}

describe('公開資料からの企業情報の候補（承認するまで反映しない）', () => {
  it('候補を表示するだけで、入力欄（ストア）は変わらない', async () => {
    global.fetch = jest.fn(async () =>
      respondWith({ companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', matches: [ROW], candidate: { fields: {
        companyName: { value: '日本製罐株式会社', source: { docId: 'S100TEST', periodEnd: '2026-03-31' }, fiscalYear: null, consolidation: 'UNKNOWN' },
        ticker: { value: '5905', source: { docId: 'S100TEST', periodEnd: '2026-03-31' }, fiscalYear: null, consolidation: 'UNKNOWN' },
      }, issues: ['連結・単体は提出書類の情報からは確認できていません（未確認として扱う）'] } }),
    ) as unknown as typeof fetch;
    const setProfileSpy = jest.spyOn(useStrategyStore.getState(), 'setProfile');
    render(<CandidatePanel />);
    await fetchCandidates();
    expect(screen.getAllByText(/連結・単体 未確認/).length).toBe(2);
    expect(useStrategyStore.getState().companyName).toBe('');
    expect(setProfileSpy).not.toHaveBeenCalled();
  });

  it('承認すると、選んだ項目だけを既存の入力処理（setProfile）で反映する', async () => {
    global.fetch = jest.fn(async () =>
      respondWith({ companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', matches: [ROW], candidate: { fields: {
        companyName: { value: '日本製罐株式会社', source: { docId: 'S100TEST', periodEnd: '2026-03-31' }, fiscalYear: null, consolidation: 'UNKNOWN' },
        ticker: { value: '5905', source: { docId: 'S100TEST', periodEnd: '2026-03-31' }, fiscalYear: null, consolidation: 'UNKNOWN' },
      }, issues: [] } }),
    ) as unknown as typeof fetch;
    render(<CandidatePanel />);
    await fetchCandidates();
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().companyName).toBe('日本製罐株式会社');
    expect(useStrategyStore.getState().ticker).toBe('5905');
    expect(useStrategyStore.getState().dirty).toBe(true);
  });

  it('取得から反映までの間に企業が切り替わったら、反映せず、取り直しを求める', async () => {
    global.fetch = jest.fn(async () =>
      respondWith({ companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', matches: [ROW], candidate: { fields: {
        companyName: { value: '日本製罐株式会社', source: { docId: 'S100TEST', periodEnd: '2026-03-31' }, fiscalYear: null, consolidation: 'UNKNOWN' },
      }, issues: [] } }),
    ) as unknown as typeof fetch;
    render(<CandidatePanel />);
    await fetchCandidates();
    act(() => setStore({ companyId: 'co-b', strategyId: 'st-b' }));
    fireEvent.click(screen.getByRole('button', { name: '承認して反映' }));
    expect(useStrategyStore.getState().companyName).toBe('');
    expect(screen.getByRole('alert').textContent).toContain('企業が切り替わったため');
  });

  it('入力済みの会社名は、上書きにチェックを入れない限り変わらない', async () => {
    setStore({ companyName: '既存の社名' });
    global.fetch = jest.fn(async () =>
      respondWith({ companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', matches: [ROW], candidate: { fields: {
        companyName: { value: '日本製罐株式会社', source: { docId: 'S100TEST', periodEnd: '2026-03-31' }, fiscalYear: null, consolidation: 'UNKNOWN' },
      }, issues: [] } }),
    ) as unknown as typeof fetch;
    render(<CandidatePanel />);
    await fetchCandidates();
    expect((screen.getByRole('checkbox', { name: /会社名/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: '承認して反映' }) as HTMLButtonElement).disabled).toBe(true);
    expect(useStrategyStore.getState().companyName).toBe('既存の社名');
  });
});
