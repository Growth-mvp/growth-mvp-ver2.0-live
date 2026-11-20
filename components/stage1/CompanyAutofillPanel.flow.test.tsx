/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PDF_IMPORT_RESPONSE } from '../../lib/autofill/__fixtures__/pdfImportResponse';

jest.mock('@/utils/supabase/client', () => ({ supabase: { auth: { getSession: jest.fn() } } }));

const CandidatePanel = require('./CompanyAutofillPanel').default as typeof import('./CompanyAutofillPanel').default;
const { useStrategyStore } = require('@/store/strategyStore') as typeof import('@/store/strategyStore');
const { useAutofillStore } = require('@/lib/autofill/autofillStore') as typeof import('@/lib/autofill/autofillStore');
const { useCeoChatStore } = require('@/store/ceoChatStore') as typeof import('@/store/ceoChatStore');
const { runDocumentFinance } = require('@/lib/autofill/publicClient') as typeof import('@/lib/autofill/publicClient');
const { buildWebProfileCandidate } = require('@/lib/autofill/publicCandidate') as typeof import('@/lib/autofill/publicCandidate');

const APPROVE = '承認して反映・保存';
const DOC_CONFIRM = /金額が円単位で記載されていることを確認しました/;
const WEB_CONFIRM = /（本人の確認）出典のURLを開き/;

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

/** 検証用PDFの取り込み応答を、実際の取り込み経路（runDocumentFinance）に通して候補を作る */
async function documentCandidateFromResponse() {
  const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => PDF_IMPORT_RESPONSE })) as unknown as typeof fetch;
  const r = await runDocumentFinance({
    files: [new File(['%PDF-1.4'], 'ph52b2-company-statement.pdf')],
    token: 'token-1',
    now: () => '2026-11-20T00:00:00.000Z',
    fetchImpl,
  });
  if (r.status !== 'FOUND') throw new Error('expected FOUND');
  return r.candidate;
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

describe('検証用PDFの候補：承認→保存→再読み込み（保存処理はモック）', () => {
  it('本人の確認をするまで承認できず、確認後に反映・保存され、再読み込み後も同じ値が残る', async () => {
    const candidate = await documentCandidateFromResponse();
    const captured: { state: Record<string, unknown> | null } = { state: null };
    mockSave.mockImplementation(async () => {
      const s = useStrategyStore.getState() as any;
      captured.state = {
        companyName: s.companyName,
        location: s.location,
        employees: s.employees,
        businessContent: s.businessContent,
        financePL: s.financePL,
        financeBS: s.financeBS,
        businessSegments: s.businessSegments,
      };
      return { ok: true, revision: 2 };
    });

    setPending(candidate);
    const first = render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    expect((screen.getByRole('button', { name: APPROVE }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    expect(mockSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: DOC_CONFIRM }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(screen.getByText('反映し、保存しました')).toBeTruthy());
    expect(mockSave).toHaveBeenCalledTimes(1);

    const s = useStrategyStore.getState() as any;
    expect(s.companyName).toBe('株式会社サンプル製作所');
    expect(s.location).toBe('東京都千代田区1-1-1');
    expect(s.employees).toBe('120');
    expect(s.businessContent).toBe('産業用機械の設計・製造');
    expect((s.financePL as any[]).find((r) => r.year === 2024)).toMatchObject({ revenue: 1_400_000_000, operatingIncome: 280_000_000, netIncome: 190_000_000 });
    expect((s.financeBS as any[]).find((r) => r.year === 2024)).toMatchObject({ totalAssets: 2_640_000_000, netAssets: 1_840_000_000 });
    expect((s.businessSegments as any[]).map((b) => b.name)).toEqual(['事業部A', '事業部B']);
    first.unmount();

    // 再読み込み：保存された内容だけを読み直す（新しい画面と同じ状態）
    setStore(BLANK);
    setStore(captured.state as Record<string, unknown>);
    expect(useAutofillStore.getState().pending).toBeNull();
    render(<CandidatePanel />);
    expect(screen.queryByRole('button', { name: APPROVE })).toBeNull();
    expect((useStrategyStore.getState() as any).companyName).toBe('株式会社サンプル製作所');

    // 同じ資料をもう一度読むと、登録済みと同じ値なので反映する項目はない
    setPending(await documentCandidateFromResponse());
    const again = render(<CandidatePanel />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: DOC_CONFIRM })).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: DOC_CONFIRM }));
    await waitFor(() => expect(screen.getByText('反映する項目はありません（すべて登録済みと同じです）')).toBeTruthy());
    expect((screen.getByRole('button', { name: APPROVE }) as HTMLButtonElement).disabled).toBe(true);
    again.unmount();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

describe('公開情報の候補：出典未照合のまま保存できない', () => {
  it('出典未照合を示し、利用者が原文を確認するチェックを入れるまで承認できない（システムの原文照合ではない）', async () => {
    const web = buildWebProfileCandidate({
      query: '株式会社サンプル製作所',
      facts: [
        { text: '会社名: 株式会社サンプル製作所', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] },
        { text: '所在地: 東京都千代田区1-1-1', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] },
      ],
      confirmedOn: '2026-11-20',
    });
    if (web.status !== 'FOUND') throw new Error('expected FOUND');
    setPending(web.candidate);
    render(<CandidatePanel />);

    await waitFor(() => expect(screen.getByRole('button', { name: APPROVE })).toBeTruthy());
    expect(screen.getByText(/システムは出典の原文を照合していません/)).toBeTruthy();
    expect(screen.getAllByText(/出典未照合/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    expect(mockSave).not.toHaveBeenCalled();
    expect((useStrategyStore.getState() as any).companyName).toBe('');

    fireEvent.click(screen.getByRole('checkbox', { name: WEB_CONFIRM }));
    fireEvent.click(screen.getByRole('button', { name: APPROVE }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect((useStrategyStore.getState() as any).companyName).toBe('株式会社サンプル製作所');
  });
});
