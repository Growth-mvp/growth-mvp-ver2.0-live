/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OperationProposal } from '@/lib/aiOperations/instruction';
import { useOperationProposalStore } from '@/lib/aiOperations/proposalStore';

const mockSave = jest.fn();
const strategyState: Record<string, unknown> = {};

jest.mock('@/utils/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token-1' } } }) } },
}));
jest.mock('@/store/strategyStore', () => ({
  useStrategyStore: { getState: () => strategyState },
}));
jest.mock('@/store/userStore', () => ({
  useUserStore: { getState: () => ({ role: 'manager' }) },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: CEOChatProposalCard } = require('./CEOChatProposalCard') as typeof import('./CEOChatProposalCard');

const PROPOSAL: OperationProposal = {
  kind: 'stage1.issue',
  pathname: '/stage1',
  companyId: 'company-1',
  strategyId: 'strategy-1',
  beforeTitles: ['既存顧客の離脱が増えている'],
  title: '新規顧客の獲得が鈍い',
  description: '',
};

const SAVE_FAILED = '保存されませんでした。';

function setScreen(over: Record<string, unknown> = {}) {
  Object.assign(strategyState, {
    companyId: 'company-1',
    strategyId: 'strategy-1',
    dirty: false,
    revision: 7,
    stage1Issues: [{ title: '既存顧客の離脱が増えている', description: '', linkedMetrics: [], scope: 'company' }],
    saveStrategyData: mockSave,
    ...over,
  });
}

function approveButton() {
  return screen.getByRole('button', { name: '承認して保存' });
}

beforeEach(() => {
  mockSave.mockReset();
  mockSave.mockResolvedValue({ ok: true });
  setScreen();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, revision: 7 }) })) as unknown as typeof fetch;
  act(() => useOperationProposalStore.getState().setPending(PROPOSAL));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('入力案の承認：STAGE1 経営課題の追加', () => {
  it('承認すると、既存の経営課題に1件を加えて保存し、保存後に成功を伝える', async () => {
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    expect(screen.getByText(/既存の経営課題は変わりません/)).toBeTruthy();
    fireEvent.click(approveButton());
    await waitFor(() => expect(onResult).toHaveBeenCalled());

    expect(mockSave).toHaveBeenCalledTimes(1);
    const call = mockSave.mock.calls[0][0];
    expect(call.conflictRetry).toBe(false);
    expect(call.patch.stage1Issues.map((i: { title: string }) => i.title)).toEqual(['既存顧客の離脱が増えている', '新規顧客の獲得が鈍い']);
    expect(onResult).toHaveBeenCalledWith('経営課題に「新規顧客の獲得が鈍い」を追加して保存しました。');
    expect(useOperationProposalStore.getState().pending).toBeNull();
  });

  it('保存に失敗したら、成功と伝えず、入力案を残す', async () => {
    mockSave.mockResolvedValue({ ok: false, reason: 'conflict' });
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    fireEvent.click(approveButton());
    await waitFor(() => expect(screen.getByText(new RegExp(SAVE_FAILED))).toBeTruthy());
    expect(onResult).not.toHaveBeenCalled();
    expect(useOperationProposalStore.getState().pending).not.toBeNull();
  });

  it('承認の前に経営課題が変わっていたら、保存せず破棄する（他の利用者の編集を上書きしない）', async () => {
    setScreen({ stage1Issues: [{ title: '別の経営課題', description: '', linkedMetrics: [], scope: 'company' }] });
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    fireEvent.click(approveButton());
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
    expect(onResult.mock.calls[0][0]).toContain('経営課題が変わったため、保存しません');
    expect(useOperationProposalStore.getState().pending).toBeNull();
  });

  it('企業が切り替わっていたら、保存せず破棄する', async () => {
    setScreen({ companyId: 'company-2' });
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    fireEvent.click(approveButton());
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
    expect(onResult.mock.calls[0][0]).toContain('企業が切り替わった');
  });

  it('未保存の変更があれば、保存せず、入力案は残す', async () => {
    setScreen({ dirty: true });
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    fireEvent.click(approveButton());
    await waitFor(() => expect(screen.getByText(/未保存の変更があるため/)).toBeTruthy());
    expect(mockSave).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('承認API（権限・所属）が拒否したら、保存しない', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })) as unknown as typeof fetch;
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    fireEvent.click(approveButton());
    await waitFor(() => expect(screen.getByText(/承認の確認ができませんでした/)).toBeTruthy());
    expect(mockSave).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('入力案の承認：説明文と検証（文字数・重複・上限）', () => {
  it('説明文を編集すると、その内容で保存する', async () => {
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    const description = screen.getAllByRole('textbox')[1] as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: '商談の数が減っていると話された。' } });
    fireEvent.click(approveButton());
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(mockSave.mock.calls[0][0].patch.stage1Issues.at(-1).description).toBe('商談の数が減っていると話された。');
  });

  it('説明文が300字を超えたら、保存せず、入力は残す', async () => {
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    const description = screen.getAllByRole('textbox')[1] as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: 'あ'.repeat(301) } });
    fireEvent.click(approveButton());
    await waitFor(() => expect(screen.getByText(/説明文は300字以内/)).toBeTruthy());
    expect(mockSave).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(useOperationProposalStore.getState().pending).not.toBeNull();
  });

  it('題名を、既存の経営課題と同じ内容に編集したら、保存せず、入力は残す（重複）', async () => {
    const onResult = jest.fn();
    render(<CEOChatProposalCard proposal={PROPOSAL} pathname="/stage1" onResult={onResult} />);
    const title = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: '既存顧客の離脱が増えている' } });
    fireEvent.click(approveButton());
    await waitFor(() => expect(screen.getByText(/同じ経営課題がすでにあるため/)).toBeTruthy());
    expect(mockSave).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
