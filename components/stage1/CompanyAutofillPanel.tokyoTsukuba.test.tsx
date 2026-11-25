/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TOKYO_TSUKUBA_FILE, TOKYO_TSUKUBA_PAGES } from '../../lib/autofill/__fixtures__/tokyoTsukubaPages';
import { buildDocumentCandidate } from '../../lib/autofill/publicCandidate';
import { buildCandidatesFromPdfText, normalizeCandidates } from '../../utils/stage1/importers/candidateBuilder';
import { extractProfileFromPages } from '../../utils/stage1/importers/profileExtract';

jest.mock('@/utils/supabase/client', () => ({ supabase: { auth: { getSession: jest.fn() } } }));

const CandidatePanel = require('./CompanyAutofillPanel').default as typeof import('./CompanyAutofillPanel').default;
const { useStrategyStore } = require('@/store/strategyStore') as typeof import('@/store/strategyStore');
const { useAutofillStore } = require('@/lib/autofill/autofillStore') as typeof import('@/lib/autofill/autofillStore');
const { useCeoChatStore } = require('@/store/ceoChatStore') as typeof import('@/store/ceoChatStore');

const APPROVE = '承認して反映・保存';
const DOC_CONFIRM = /金額が円単位で記載されていることを確認しました/;

const mockSave = jest.fn();

const BLANK = {
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
};

function setStore(over: Record<string, unknown>) {
  useStrategyStore.setState({ companyId: 'co-a', strategyId: 'st-a', loaded: true, saveStrategyData: mockSave, ...over } as any);
}

function setPending(candidate: unknown) {
  useAutofillStore.setState({ pending: { companyId: 'co-a', strategyId: 'st-a', fetchedAt: 'now', candidate: candidate as never } });
}

function tokyoTsukubaCandidate() {
  const candidates = normalizeCandidates(buildCandidatesFromPdfText(TOKYO_TSUKUBA_PAGES).map((c) => ({ ...c, source: TOKYO_TSUKUBA_FILE })) as never);
  const profile = extractProfileFromPages(TOKYO_TSUKUBA_PAGES, TOKYO_TSUKUBA_FILE);
  const result = buildDocumentCandidate({ candidates, profiles: [profile], fetchedAt: '2026-11-26T00:00:00.000Z' });
  if (result.status !== 'FOUND') throw new Error('expected FOUND');
  return result.candidate;
}

beforeEach(() => {
  mockSave.mockReset();
  mockSave.mockResolvedValue({ ok: true, revision: 1 });
  setStore(BLANK);
  useAutofillStore.setState({ pending: null });
  useCeoChatStore.setState({ ownerKey: null, messages: [], pending: false });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('東つくば地域サービスの資料（千円表記）：承認→保存→再読み込み（保存処理はモック）', () => {
  it('PDFの原本どおりに円へ換算して反映し、再読み込み後も同じ値が残る', async () => {
    const captured: { state: Record<string, unknown> | null } = { state: null };
    mockSave.mockImplementation(async () => {
      const s = useStrategyStore.getState() as any;
      captured.state = {
        companyName: s.companyName,
        location: s.location,
        employees: s.employees,
        financePL: s.financePL,
        financeBS: s.financeBS,
        businessSegments: s.businessSegments,
      };
      return { ok: true, revision: 2 };
    });

    setPending(tokyoTsukubaCandidate());
    const first = render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: DOC_CONFIRM }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(screen.getByText('反映し、保存しました')).toBeTruthy());
    expect(mockSave).toHaveBeenCalledTimes(1);

    const s = useStrategyStore.getState() as any;
    expect(s.companyName).toBe('株式会社東つくば地域サービス');
    expect(s.location).toBe('茨城県つくば市');
    expect(s.employees).toBe('15');
    expect((s.financePL as any[]).map((r) => r.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect((s.financePL as any[]).find((r) => r.year === 2022)).toMatchObject({ revenue: 161_000_000, operatingIncome: 6_700_000 });
    expect((s.financePL as any[]).find((r) => r.year === 2026)).toMatchObject({ revenue: 172_000_000, operatingIncome: 4_500_000 });
    expect((s.financeBS as any[]).find((r) => r.year === 2026)).toMatchObject({ totalAssets: 84_000_000, netAssets: 28_000_000 });
    expect((s.financeBS as any[]).some((r) => r.year !== 2026 && r.totalAssets !== undefined)).toBe(false);
    expect((s.businessSegments as any[]).map((b) => b.name)).toEqual(['新聞販売・配達', '宅配', 'フィットネス']);
    expect((s.businessSegments as any[]).map((b) => b.revenue)).toEqual([122, 28, 22]);
    expect((s.financeBS as any[]).find((r) => r.year === 2026)).toMatchObject({ cash: 12_000_000, interestBearingDebt: 23_000_000 });
    expect((s.segmentPL['宅配'] as any[]).find((r) => r.year === 2025)).toMatchObject({ revenue: 21_000_000, operatingIncome: 1_500_000 });
    expect((s.segmentPL['フィットネス'] as any[]).map((r) => r.revenue)).toEqual([0, 4_000_000, 11_000_000, 16_500_000, 22_000_000]);
    expect(s.businessContent).toContain('新聞販売・配達事業');
    expect(s.industry).toBe('');
    first.unmount();

    setStore(BLANK);
    setStore(captured.state as Record<string, unknown>);
    expect(useAutofillStore.getState().pending).toBeNull();
    render(<CandidatePanel />);
    expect(screen.queryByRole('button', { name: APPROVE })).toBeNull();
    expect((useStrategyStore.getState() as any).companyName).toBe('株式会社東つくば地域サービス');
    expect(((useStrategyStore.getState() as any).financePL as any[]).find((r) => r.year === 2026)).toMatchObject({ revenue: 172_000_000 });
  });

  it('登録中の値と違う年度は、上書きを選ぶまで変えず、空いている項目だけを反映する', async () => {
    setStore({ ...BLANK, financePL: [{ year: 2024, revenue: 999 }] });
    setPending(tokyoTsukubaCandidate());
    render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    expect(screen.getByText(/登録中 999円/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: DOC_CONFIRM }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(screen.getByText('反映し、保存しました')).toBeTruthy());

    const s = useStrategyStore.getState() as any;
    expect(s.financePL.find((r: any) => r.year === 2024)).toMatchObject({ revenue: 999, operatingIncome: 3_400_000 });
  });
});
