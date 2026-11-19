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
const { ceoChatOwnerKey, openCeoChatRequest, updateCeoChatMessages } = require('@/store/ceoChatStore') as typeof import('@/store/ceoChatStore');

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const STRATEGY_A = 'strategy-a';
const STRATEGY_B = 'strategy-b';
const GENERIC_ERROR = '通信エラー。ネットワーク/ログイン/権限をご確認ください。';

const mockFetch = jest.fn();
const RISK_REVIEW_URL = '/api/companion/risk-review';
const mockRiskFetch = jest.fn();
const NO_RISK_RESPONSE = { ok: true, status: 200, text: async () => JSON.stringify({ facts: [], text: null, serious: false }) };

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
const GREETING_HISTORY = { role: 'assistant', content: '操作の質問から、仕事や経営の相談まで、何でも聞いてください。' };

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
  sessionStorage.clear();
  mockPathname = '/stage1';
  jest.clearAllMocks();
  mockFetch.mockReset();
  mockRiskFetch.mockReset();
  mockRiskFetch.mockImplementation(async () => NO_RISK_RESPONSE);
  global.fetch = ((url: string, init?: unknown) =>
    String(url).includes(RISK_REVIEW_URL) ? mockRiskFetch(url, init) : mockFetch(url, init)) as unknown as typeof fetch;
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
  useUserStore.setState({ user: null, companyId: null } as any);
  useUserStore.setState({ user: { id: 'user-1' } as any, companyId: COMPANY_A } as any);
  setReady(COMPANY_A, STRATEGY_A);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const TITLE_ENTER_NAME = '次は会社の基本情報を入力しましょう';
const TITLE_GO_STAGE2 = 'STAGE2（経営戦略）へ進めます';

function setStoreData(over: Record<string, unknown>) {
  act(() => {
    useStrategyStore.setState({ loaded: true, ...over } as any);
  });
}

function companionCardText(): string {
  return document.querySelector('[data-companion-key]')?.textContent ?? '';
}

function companionToggle(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('自律伴走')) ?? null;
}

async function turnCompanionOn() {
  fireEvent.click(companionToggle() as HTMLButtonElement);
  await flush();
}

describe('自律伴走：初期状態と判定の安全性', () => {
  it('初期状態はOFF。条件を満たしていても、案内もAI呼び出しも出ない', async () => {
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    expect(companionToggle()?.textContent).toContain('オフ（オンにする）');
    expect(companionCardText()).toBe('');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('オンにすると、会社名が未入力の案内を出す（リンク付き）。AIは呼ばない', async () => {
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(companionCardText()).toContain(TITLE_ENTER_NAME);
    const link = document.querySelector('a[href="/stage1"]');
    expect(link?.textContent).toBe('STAGE1を開く');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('読み込み中（restoreReady=false）は、条件が揃っていても判定しない', async () => {
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    act(() => {
      useStrategyStore.setState({ restoreReady: false } as any);
    });
    await turnCompanionOn();
    expect(companionCardText()).toBe('');
  });

  it('読み込みに失敗した（最後のサーバー同期でエラー）ときは、判定しない', async () => {
    setStoreData({ companyName: '', __lastServerError: { message: 'x' } });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(companionCardText()).toBe('');
  });
});

describe('自律伴走：重複発話と上限', () => {
  it('閉じた案内は、画面を移動して戻っても、同じ状態では出し直さない', async () => {
    setStoreData({ companyName: '' });
    const view = await renderReadyPanel();
    await turnCompanionOn();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(companionCardText()).toBe('');

    mockPathname = '/stage1';
    view.rerender(<CEOChatPanel />);
    await flush();
    expect(companionCardText()).toBe('');
  });

  it('論点を保存すると、分析完了の節目として助言を一度だけ依頼する。それ以外の時はAIを呼ばない', async () => {
    mockFetch.mockResolvedValue(okResponse('分析の助言本文'));
    setStoreData({ companyName: '会社A', financePL: [{ year: 2025, revenue: 1000, operatingIncome: 50 }], stage1Issues: [] });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(companionCardText()).toContain('論点を1件作りましょう');
    expect(mockFetch).not.toHaveBeenCalled();

    // 論点の保存（未保存の変更がない状態）として判定させる
    setStoreData({ stage1Issues: [{ id: 'i1', title: '論点' }], dirty: false });
    await waitFor(() => expect(companionCardText()).toContain('分析の助言本文'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sentBody(0).meta.companion.milestone).toBe('ANALYSIS');

    // 同じ内容のままでは、二度目の依頼をしない
    setStoreData({ stage1Issues: [{ id: 'i1', title: '論点' }], dirty: false });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('STAGE2を始めた後は、次の一歩（経営戦略の生成）を案内する', async () => {
    mockFetch.mockResolvedValue(okResponse('分析の助言'));
    setStoreData({ companyName: '会社A', financePL: [{ year: 2025, revenue: 1000 }], stage1Issues: [{ id: 'i1' }], answers12: [] });
    await renderReadyPanel();
    await turnCompanionOn();
    await waitFor(() => expect(companionCardText()).toContain('分析の助言'));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await flush();
    expect(companionCardText()).toContain(TITLE_GO_STAGE2);

    // 直前の案内から1分以内は、次の案内を間隔の後に出す（失わずに、間隔が過ぎたら表示する）
    jest.useFakeTimers({ advanceTimers: true });
    try {
      setStoreData({ answers12: [{ id: 'ch0-q1', answer: '回答' }] });
      await flush();
      expect(companionCardText()).toBe('');
      act(() => {
        jest.advanceTimersByTime(61_000);
      });
      await flush();
      expect(companionCardText()).toContain('経営戦略を生成しましょう');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('自律伴走：企業の分離', () => {
  it('会社を切り替えると、前の会社の案内は消え、新しい会社の状態で判定する', async () => {
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(document.querySelector('[data-companion-key]')?.getAttribute('data-companion-key')).toContain(COMPANY_A);

    switchCompany(COMPANY_B);
    completeSwitchTo(COMPANY_B, STRATEGY_B);
    setStoreData({ companyName: '会社B', financePL: [{ year: 2025, revenue: 900 }], stage1Issues: [] });
    await flush();
    const key = document.querySelector('[data-companion-key]')?.getAttribute('data-companion-key') ?? '';
    expect(key).toContain(COMPANY_B);
    expect(key).not.toContain(COMPANY_A);
    expect(companionCardText()).toContain('論点を1件作りましょう');
  });

  it('助言の依頼が処理中に会社を切り替えても、切替前の会社の助言は表示も保存もしない', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    mockFetch.mockReturnValueOnce(pending.promise);
    setStoreData({ companyName: '会社A', financePL: [{ year: 2025, revenue: 1000 }], stage1Issues: [{ id: 'i1' }], answers12: [], dirty: false });
    await renderReadyPanel();
    await turnCompanionOn();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(companionCardText()).toContain('AIの助言');

    switchCompany(COMPANY_B);
    completeSwitchTo(COMPANY_B, STRATEGY_B);
    setStoreData({ companyName: '会社B', financePL: [{ year: 2025, revenue: 900 }], stage1Issues: [], answers12: [], dirty: false });
    await flush();

    await act(async () => {
      pending.resolve(okResponse('会社Aの助言本文'));
    });
    await flush();
    expect(document.body.textContent).not.toContain('会社Aの助言本文');
    expect(companionCardText()).not.toContain('AIの助言');
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('会社Aの助言本文');
  });

  it('画面の会社と保存データの会社が違う（切替中）間は、判定しない', async () => {
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(companionCardText()).toContain(TITLE_ENTER_NAME);

    switchUserCompanyOnly(COMPANY_B);
    await flush();
    expect(companionCardText()).toBe('');
    expect(document.querySelector('[data-companion-key]')).toBeNull();
  });
});

describe('自律伴走：AIを使うのは利用者が選んだ時だけ', () => {
  it('「この件をAIに相談する」を押すと、通常のチャット送信として一度だけ送る', async () => {
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    mockFetch.mockResolvedValueOnce(okResponse('相談への回答'));

    fireEvent.click(screen.getByRole('button', { name: 'この件をAIに相談する' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const body = sentBody(0);
    expect(JSON.stringify(body)).toContain(TITLE_ENTER_NAME);
    expect(companionCardText()).toBe('');
  });

  it('AIが失敗していても、案内は出る（案内はAIに依存しない）', async () => {
    setStoreData({ companyName: '会社A', financePL: [{ year: 2025, revenue: 1000 }], stage1Issues: [] });
    await renderReadyPanel();
    mockFetch.mockResolvedValue(errorResponse(500));
    await turnCompanionOn();
    expect(companionCardText()).toContain('論点を1件作りましょう');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('伴走をオフにすると、表示中の案内は消え、以後は出ない', async () => {
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(companionCardText()).toContain(TITLE_ENTER_NAME);
    fireEvent.click(companionToggle() as HTMLButtonElement);
    await flush();
    expect(companionCardText()).toBe('');
    expect(companionToggle()?.textContent).toContain('オフ（オンにする）');
  });
});

describe('自律伴走：権限', () => {
  it('編集権限がない利用者には、編集は管理者・管理職が行うと添える', async () => {
    useUserStore.setState({ role: 'member' } as any);
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(companionCardText()).toContain('編集は管理者・管理職が行います');
  });
});

beforeEach(() => {
  useUserStore.setState({ role: 'admin' } as any);
});

beforeEach(() => {
  useStrategyStore.setState({
    __lastServerError: undefined,
    restoreReady: true,
    loaded: true,
    companyName: '',
    financePL: [],
    stage1Issues: [],
    answers12: [],
    finalStory: [],
    finalStoryDraft: [],
    finalStoryEdited: [],
    finalStoryFinal: [],
  } as any);
});

describe('自律伴走：見えた時にだけ表示済みにする', () => {
  afterEach(() => {
    delete (global as any).IntersectionObserver;
  });

  it('引き出しが閉じていて案内が画面内に見えないときは、表示済みにしない（見えた時に記録する）', async () => {
    let onIntersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    (global as any).IntersectionObserver = class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        onIntersect = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    expect(companionCardText()).toContain(TITLE_ENTER_NAME);
    expect(localStorage.getItem('growth.ceoCompanion.days.v1:user-1:' + COMPANY_A)).toBeNull();

    act(() => {
      onIntersect?.([{ isIntersecting: true }]);
    });
    expect(localStorage.getItem('growth.ceoCompanion.days.v1:user-1:' + COMPANY_A)).not.toBeNull();
  });
});

describe('自律伴走：助言の失敗と再依頼', () => {
  it('助言の依頼が失敗しても、同じ節目では自動で再依頼せず、案内も出さない', async () => {
    mockFetch.mockResolvedValue(errorResponse(500));
    setStoreData({ companyName: '会社A', financePL: [{ year: 2025, revenue: 1000 }], stage1Issues: [{ id: 'i1' }], answers12: [], dirty: false });
    await renderReadyPanel();
    await turnCompanionOn();
    await flush();
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(companionCardText()).not.toContain('助言');

    // 画面の遷移や再表示があっても、同じ節目の助言は依頼しない
    setStoreData({ stage1Issues: [{ id: 'i1' }], dirty: false });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('未保存の変更がある間は、助言を依頼しない（保存済みの内容だけで助言する）', async () => {
    mockFetch.mockResolvedValue(okResponse('助言本文'));
    setStoreData({ companyName: '会社A', financePL: [{ year: 2025, revenue: 1000 }], stage1Issues: [{ id: 'i1' }], answers12: [], dirty: true });
    await renderReadyPanel();
    await turnCompanionOn();
    await flush();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(companionCardText()).toContain('未保存の変更があります');
  });
});

describe('自律伴走：経営点検（STAGE5・6）は会社ごとに1日1回', () => {

  function completeStoreForReview() {
    setStoreData({
      companyName: '会社A',
      financePL: [{ year: 2025, revenue: 1000 }],
      stage1Issues: [{ id: 'i1' }],
      answers12: [{ id: 'ch0-q1', answer: '回答' }],
      finalStory: [{ title: '危機' }],
      departments: [{ name: '営業部', projects: [{ title: 'A', planStatus: 'approved' }] }],
      stage3_strategy_bridge: { strategicCore: {} },
      dirty: false,
    });
  }

  function riskCalls() {
    return mockRiskFetch.mock.calls;
  }

  beforeEach(() => {
    mockPathname = '/stage6';
    mockFetch.mockImplementation(async () => okResponse('節目の助言'));
    mockRiskFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ facts: ['- 2027年度：施策反映後の期末現預金が不足の見込み'], text: '仮説：回収の遅れが原因の可能性' }),
    }));
  });

  it('STAGE6で、事実があれば所見を一度だけ依頼し、事実を先に表示する。同じ日の再表示では依頼しない', async () => {
    completeStoreForReview();
    const view = await renderReadyPanel();
    await turnCompanionOn();
    await waitFor(() => expect(companionCardText()).toContain('仮説：回収の遅れ'));
    expect(companionCardText()).toContain('事実（保存済みデータの計算結果）');
    expect(companionCardText()).toContain('2027年度');
    expect(riskCalls()).toHaveLength(1);

    view.unmount();
    const again = await renderReadyPanel();
    await turnCompanionOn();
    await flush();
    expect(riskCalls()).toHaveLength(1);
    again.unmount();
  });

  it('点検していない範囲（費用の計画と実績、会社全体のKR）を、所見の本文に必ず添える', async () => {
    completeStoreForReview();
    await renderReadyPanel();
    await turnCompanionOn();
    await waitFor(() => expect(companionCardText()).toContain('点検していない範囲'));
    expect(companionCardText()).toContain('費用（OPEX・コスト削減・追加費用）の計画と実績');
  });

  it('重大なリスク（資金不足・目標未達）は、進行の案内が残っていても進行の案内より前に出す', async () => {
    mockPathname = '/stage1';
    mockRiskFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ facts: ['- 2027年度：不足'], text: '仮説：回収の遅れ', serious: true }),
    }));
    setStoreData({ companyName: '' });
    await renderReadyPanel();
    await turnCompanionOn();
    await waitFor(() => expect(companionCardText()).toContain('仮説：回収の遅れ'));
    expect(companionCardText()).not.toContain(TITLE_ENTER_NAME);
  });

  it('重大でないリスクは、進行の案内が残っている間は出さず、進行の案内を優先する', async () => {
    mockPathname = '/stage1';
    setStoreData({
      companyName: '',
      stage1Issues: [],
      answers12: [],
      finalStory: [],
      departments: [],
      stage3_strategy_bridge: undefined,
    });
    await renderReadyPanel();
    await turnCompanionOn();
    await waitFor(() => expect(riskCalls()).toHaveLength(1));
    await flush();
    expect(companionCardText()).toContain(TITLE_ENTER_NAME);
    expect(companionCardText()).not.toContain('仮説');
  });

  it('会社ごとの経営点検は、画面を移っても1日1回しか依頼しない', async () => {
    mockPathname = '/stage1';
    setStoreData({ companyName: '' });
    const view = await renderReadyPanel();
    await turnCompanionOn();
    await waitFor(() => expect(riskCalls()).toHaveLength(1));
    mockPathname = '/stage6';
    view.rerender(<CEOChatPanel />);
    await flush();
    expect(riskCalls()).toHaveLength(1);
  });
});
