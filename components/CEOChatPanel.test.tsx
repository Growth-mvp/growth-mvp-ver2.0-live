/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGetSession = jest.fn();
let mockPathname = '/stage1';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@/utils/supabase/client', () => {
  // 本番の接続情報が環境にあっても使わないよう、ダミーの接続先で上書きする（通信は getSession をモックして行わない）
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  const actual = jest.requireActual('@/utils/supabase/client');
  return {
    ...actual,
    supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
    safeGetSession: async () => ({ error: null, data: { session: { user: { id: 'user-1' } } } }),
  };
});

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: jest.fn(async () => ({ data: null, error: null })),
    saveStrategyData: jest.fn(async () => ({ ok: true })),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: () => 0,
    getFullStrategyDataByStrategyId: jest.fn(async () => {
      throw new Error('unexpected call: getFullStrategyDataByStrategyId');
    }),
    deleteStrategyData: jest.fn(async () => {
      throw new Error('unexpected call: deleteStrategyData');
    }),
  };
});

jest.mock('@/components/AbstractCoachAvatar', () => ({
  __esModule: true,
  default: () => null,
}));

// esbuild 変換は jest.mock を巻き上げないため、モック登録の後で読み込む
const { default: CEOChatPanel } = require('./CEOChatPanel') as typeof import('./CEOChatPanel');
const { useUserStore } = require('@/store/userStore') as typeof import('@/store/userStore');
const { useStrategyStore } = require('@/store/strategyStore') as typeof import('@/store/strategyStore');
import { describeAskFailure } from '@/lib/ceoChat/askPolicy';

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const STRATEGY_A = 'strategy-a';
const STRATEGY_B = 'strategy-b';
const GENERIC_ERROR = '通信エラー。ネットワーク/ログイン/権限をご確認ください。';

const mockFetch = jest.fn();

Element.prototype.scrollIntoView = jest.fn();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function okResponse(content: string) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ content }) };
}

function errorResponse(status: number) {
  return { ok: false, status, text: async () => JSON.stringify({ error: 'error' }) };
}

// パネルの初期表示（挨拶）は会話履歴として送信内容に含まれる（既存仕様）
const GREETING_HISTORY = { role: 'assistant', content: 'こんにちは。AI経営コンサルタントです。' };

function chatBubbles(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? '';
}

function sentBody(callIndex = 0) {
  return JSON.parse(mockFetch.mock.calls[callIndex][1].body);
}

function setReady(companyId: string, strategyId: string) {
  act(() => {
    useStrategyStore.setState({
      companyId,
      pendingCompanyId: undefined,
      strategyId,
      restoreReady: true,
      __isFetchingFromServer: false,
      boot: { isHydrating: false, isHydrated: true },
    } as any);
  });
}

// 画面の企業だけが切り替わり、ストアはまだ古いまま（切替途中）
function switchUserCompanyOnly(companyId: string | null) {
  act(() => {
    useUserStore.setState({ companyId } as any);
  });
}

// 企業切替（layoutClient が行う userStore 更新と strategyStore のスコープ変更）
function switchCompany(companyId: string) {
  act(() => {
    useUserStore.setState({ companyId } as any);
    useStrategyStore.getState().setCompanyScope(companyId);
  });
}

// 切替の確定（refetch 完了により strategyStore が新企業の値を持つ状態）
function completeSwitchTo(companyId: string, strategyId: string) {
  act(() => {
    useStrategyStore.getState().setCompanyScope(companyId);
  });
  setReady(companyId, strategyId);
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderReadyPanel() {
  const view = render(<CEOChatPanel />);
  await waitFor(() => expect(textbox().disabled).toBe(false));
  return view;
}

function textbox() {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

function sendButton() {
  return screen.getByRole('button', { name: '送信' }) as HTMLButtonElement;
}

async function sendText(text: string) {
  fireEvent.change(textbox(), { target: { value: text } });
  await waitFor(() => expect(sendButton().disabled).toBe(false));
  fireEvent.click(sendButton());
}

beforeEach(() => {
  localStorage.clear();
  mockPathname = '/stage1';
  jest.clearAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
  useUserStore.setState({ user: { id: 'user-1' } as any, companyId: COMPANY_A } as any);
  setReady(COMPANY_A, STRATEGY_A);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('企業切替と送信ゲート', () => {
  it('企業切替中（画面は B、ストアは A）に送信しても API を呼ばず、案内と入力の保持を行う', async () => {
    await renderReadyPanel();
    switchUserCompanyOnly(COMPANY_B);

    await sendText('質問');

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('企業を切り替えています')
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(textbox().value).toBe('質問');
  });

  it('企業情報が無い（画面の企業が null）場合も送信せず、入力を保持する', async () => {
    await renderReadyPanel();
    switchUserCompanyOnly(null);

    await sendText('質問');

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('企業情報を確認できません')
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(textbox().value).toBe('質問');
  });

  it('getSession 待機中に企業が切り替わり、ストアがまだ古い間は、旧 strategyId で送信しない', async () => {
    const session = deferred<unknown>();
    mockGetSession.mockReturnValueOnce(session.promise);
    await renderReadyPanel();

    await sendText('質問');
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());

    switchUserCompanyOnly(COMPANY_B);
    act(() => {
      useStrategyStore.getState().setCompanyScope(COMPANY_B);
    });

    await act(async () => {
      session.resolve({ data: { session: { access_token: 'token-1' } } });
    });
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it(
    'getSession 待機中に企業切替が完了しても、切替前の企業のリクエストを送らない',
    async () => {
      const session = deferred<unknown>();
      mockGetSession.mockReturnValueOnce(session.promise);
      mockFetch.mockResolvedValue(okResponse('回答'));
      await renderReadyPanel();

      await sendText('質問');
      await waitFor(() => expect(mockGetSession).toHaveBeenCalled());

      switchCompany(COMPANY_B);
      setReady(COMPANY_B, STRATEGY_B);

      await act(async () => {
        session.resolve({ data: { session: { access_token: 'token-1' } } });
      });
      await flush();

      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it('A社への送信後にB社へ切り替え、遅れて届いた A社の応答は表示しない', async () => {
    const pending = deferred<unknown>();
    mockFetch.mockReturnValueOnce(pending.promise);
    await renderReadyPanel();

    await sendText('A社への質問');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    switchCompany(COMPANY_B);
    setReady(COMPANY_B, STRATEGY_B);

    await act(async () => {
      pending.resolve(okResponse('A社の回答'));
    });
    await flush();

    expect(chatBubbles()).not.toContain('A社の回答');
    expect(chatBubbles()).not.toContain('A社への質問');
    expect(chatBubbles()).toContain('こんにちは。AI経営コンサルタントです。');
  });

  it('A社からB社へ切り替えると A社の会話履歴を破棄し、B社の送信には A社の履歴を含めない', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('A社の回答'));
    await renderReadyPanel();

    await sendText('A社への質問');
    await waitFor(() => expect(screen.getByText('A社の回答')).toBeTruthy());

    switchCompany(COMPANY_B);
    setReady(COMPANY_B, STRATEGY_B);
    await flush();

    expect(chatBubbles()).not.toContain('A社の回答');
    expect(chatBubbles()).not.toContain('A社への質問');

    mockFetch.mockResolvedValueOnce(okResponse('B社の回答'));
    await sendText('B社への質問');
    await waitFor(() => expect(screen.getByText('B社の回答')).toBeTruthy());

    expect(sentBody(1).companyId).toBe(COMPANY_B);
    expect(sentBody(1).strategyId).toBe(STRATEGY_B);
    expect(sentBody(1).messages).toEqual([GREETING_HISTORY, { role: 'user', content: 'B社への質問' }]);
  });

  it('アンマウント後に届いた応答は、再マウント後の画面に表示されない', async () => {
    const pending = deferred<unknown>();
    mockFetch.mockReturnValueOnce(pending.promise);
    const first = await renderReadyPanel();

    await sendText('質問');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    first.unmount();
    await act(async () => {
      pending.resolve(okResponse('古い回答'));
    });

    await renderReadyPanel();
    await flush();

    expect(screen.queryByText('古い回答')).toBeNull();
    expect(screen.getByText('こんにちは。AI経営コンサルタントです。')).toBeTruthy();
  });
});

describe('企業切替時の下書きと遅延応答', () => {
  it('A社の未送信の下書きは、切替時にクリアされ、B社の入力欄へ引き継がれない', async () => {
    await renderReadyPanel();
    fireEvent.change(textbox(), { target: { value: 'A社の下書き' } });

    switchCompany(COMPANY_B);
    setReady(COMPANY_B, STRATEGY_B);
    await flush();

    expect(textbox().value).toBe('');
  });

  it('切替確定前に送信が拒否された下書きは、保持される', async () => {
    await renderReadyPanel();
    switchUserCompanyOnly(COMPANY_B);

    await sendText('B社の下書き');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('企業を切り替えています')
    );

    expect(textbox().value).toBe('B社の下書き');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('切替中に入力した文章は、切替確定後も入力欄に保持される', async () => {
    await renderReadyPanel();
    switchUserCompanyOnly(COMPANY_B);
    fireEvent.change(textbox(), { target: { value: '切替中に入力したB社の文章' } });

    completeSwitchTo(COMPANY_B, STRATEGY_B);
    await flush();

    expect(textbox().value).toBe('切替中に入力したB社の文章');
  });

  it('切替中に送信が拒否された通知は、切替確定後の画面に残らない', async () => {
    await renderReadyPanel();
    switchUserCompanyOnly(COMPANY_B);
    await sendText('B社の下書き');
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull());

    completeSwitchTo(COMPANY_B, STRATEGY_B);
    await flush();

    expect(screen.queryByRole('status')).toBeNull();
    expect(textbox().value).toBe('B社の下書き');
  });

  it('A社の遅延応答によって、B社の入力欄と会話履歴は変更されない', async () => {
    const pending = deferred<unknown>();
    mockFetch.mockReturnValueOnce(pending.promise);
    await renderReadyPanel();

    await sendText('A社への質問');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    switchCompany(COMPANY_B);
    setReady(COMPANY_B, STRATEGY_B);
    fireEvent.change(textbox(), { target: { value: 'B社の下書き' } });

    await act(async () => {
      pending.resolve(okResponse('A社の回答'));
    });
    await flush();

    expect(textbox().value).toBe('B社の下書き');
    expect(chatBubbles()).not.toContain('A社の回答');
    expect(chatBubbles()).not.toContain('A社への質問');
  });

  it('同一企業内の再描画や状態の更新では、入力中の下書きを消さない', async () => {
    await renderReadyPanel();
    fireEvent.change(textbox(), { target: { value: '保持される下書き' } });

    act(() => {
      useUserStore.setState({ companyId: COMPANY_A } as any);
    });
    setReady(COMPANY_A, STRATEGY_A);
    await flush();

    expect(textbox().value).toBe('保持される下書き');
  });

  it('企業切替後、B社として正常に質問でき、B社の情報で送信される', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('B社の回答'));
    await renderReadyPanel();

    switchCompany(COMPANY_B);
    setReady(COMPANY_B, STRATEGY_B);
    await sendText('B社への質問');
    await waitFor(() => expect(screen.getByText('B社の回答')).toBeTruthy());

    expect(sentBody().companyId).toBe(COMPANY_B);
    expect(sentBody().strategyId).toBe(STRATEGY_B);
    expect(sentBody().messages).toEqual([GREETING_HISTORY, { role: 'user', content: 'B社への質問' }]);
  });
});

describe('画面情報の送信', () => {
  it('登録済みの画面からの送信は、screenId だけを送る（pathname は送らない）', async () => {
    mockPathname = '/stage1';
    mockFetch.mockResolvedValueOnce(okResponse('回答'));
    await renderReadyPanel();

    await sendText('質問');
    await waitFor(() => expect(screen.getByText('回答')).toBeTruthy());

    expect(sentBody().screen).toEqual({ screenId: 'stage1' });
    expect(JSON.stringify(sentBody())).not.toContain('/stage1');
  });

  it('未登録の pathname からの送信は、画面情報を含めない', async () => {
    mockPathname = '/no-such-page';
    mockFetch.mockResolvedValueOnce(okResponse('回答'));
    await renderReadyPanel();

    await sendText('質問');
    await waitFor(() => expect(screen.getByText('回答')).toBeTruthy());

    expect(sentBody().screen).toBeUndefined();
    expect(JSON.stringify(sentBody())).not.toContain('/no-such-page');
  });
});

describe('同一企業での送信', () => {
  it('companyId と strategyId が同じ企業に属するとき、正しい値で送信し、応答を表示する', async () => {
    mockFetch.mockResolvedValueOnce(okResponse('回答です'));
    await renderReadyPanel();

    await sendText('質問');
    await waitFor(() => expect(screen.getByText('回答です')).toBeTruthy());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({
      userId: 'user-1',
      strategyId: STRATEGY_A,
      companyId: COMPANY_A,
      screen: { screenId: 'stage1' },
      messages: [GREETING_HISTORY, { role: 'user', content: '質問' }],
    });
    expect(textbox().value).toBe('');
  });
});

describe('エラー表示', () => {
  it.each([
    ['401', 401],
    ['403', 403],
    ['429', 429],
    ['500', 500],
  ])('HTTP %s の応答は、その種別に応じた案内を表示する', async (_label, status) => {
    mockFetch.mockResolvedValueOnce(errorResponse(status));
    await renderReadyPanel();

    await sendText('質問');

    const expected = describeAskFailure({ kind: 'http', status });
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(GENERIC_ERROR)).toBeNull();
  });

  it('ネットワーク断は、通信の案内を表示する', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await renderReadyPanel();

    await sendText('質問');

    const expected = describeAskFailure({ kind: 'network' });
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(GENERIC_ERROR)).toBeNull();
  });

  it('送信に失敗した質問は履歴に残り、入力欄は空になる（現状の仕様）', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    await renderReadyPanel();

    await sendText('失敗した質問');
    await waitFor(() =>
      expect(screen.getByText(describeAskFailure({ kind: 'http', status: 500 }))).toBeTruthy()
    );
    expect(screen.getByText('失敗した質問')).toBeTruthy();
    expect(textbox().value).toBe('');
  });
});
