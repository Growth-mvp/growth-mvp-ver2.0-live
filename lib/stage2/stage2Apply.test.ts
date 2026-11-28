import { applyStage2Op } from './stage2Apply';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAiHighlightStore } from '@/store/aiHighlightStore';
import { supabase } from '@/utils/supabase/client';

jest.mock('@/utils/supabase/client', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('@/store/strategyStore', () => ({ useStrategyStore: { getState: jest.fn() } }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: jest.fn() } }));
jest.mock('@/lib/aiOperations/saveSettle', () => ({
  waitForSaveSettled: jest.fn(async () => 'dirty'),
  saveSentenceOf: () => '保存はまだです。',
}));

function setStore(over: Record<string, unknown> = {}) {
  const state: Record<string, any> = {
    companyId: 'c1',
    strategyId: 's1',
    revision: 3,
    ceoIntent: '既存の思い',
    mission: '',
    vision: '',
    value: '',
    strength: 'A',
    weakness: '',
    opportunity: '',
    threat: '',
    companyTargets: [{ id: 't-1', label: '営業利益', unit: '万円', base: 5000 }],
    answers12: [{ id: 'ch1-q2', question: 'q', answer: '' }],
    setCeoIntent: jest.fn((text: string) => {
      state.ceoIntent = text;
    }),
    setMVV: jest.fn((patch: Record<string, string>) => Object.assign(state, patch)),
    setSWOT: jest.fn((patch: Record<string, string>) => Object.assign(state, patch)),
    addCompanyTarget: jest.fn((t: Record<string, unknown>) => {
      state.companyTargets = [...state.companyTargets, t];
    }),
    updateCompanyTarget: jest.fn((id: string, patch: Record<string, unknown>) => {
      state.companyTargets = state.companyTargets.map((t: Record<string, unknown>) => (t.id === id ? { ...t, ...patch } : t));
    }),
    updateAnswer12: jest.fn((id: string, patch: Record<string, unknown>) => {
      state.answers12 = state.answers12.map((a: Record<string, unknown>) => (a.id === id ? { ...a, ...patch } : a));
    }),
    ...over,
  };
  (useStrategyStore.getState as jest.Mock).mockReturnValue(state);
  return state;
}

function allowAuthorize(sessionUser = 'u1', revision = 3) {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: { access_token: 't', user: { id: sessionUser } } },
  });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ revision }) }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useUserStore.getState as jest.Mock).mockReturnValue({ role: 'admin', user: { id: 'u1' } });
  useAiHighlightStore.setState({ target: null, at: 0, reveal: null });
});

describe('STAGE2の直接反映：管理者の権限と認可', () => {
  it('管理者でなければ、経営者の思いも他の入力も反映しない', async () => {
    (useUserStore.getState as jest.Mock).mockReturnValue({ role: 'manager', user: { id: 'u1' } });
    const state = setStore();
    allowAuthorize();
    const r = await applyStage2Op({ kind: 'ceo.append', text: '地域の暮らし' }, { settleMs: 0 });
    expect(r.ok).toBe(false);
    expect(state.setCeoIntent).not.toHaveBeenCalled();
  });

  it('経営者の思いは認可の種類を分けて確認し、他の入力は stage2.input で確認する', async () => {
    setStore();
    allowAuthorize();
    await applyStage2Op({ kind: 'ceo.append', text: '地域の暮らし' }, { settleMs: 0 });
    await applyStage2Op({ kind: 'mvv.set', field: 'mission', value: '地域を支える' }, { settleMs: 0 });
    const bodies = (global.fetch as jest.Mock).mock.calls.map((c) => JSON.parse(c[1].body).operation);
    expect(bodies).toEqual(['stage2.ceoIntent', 'stage2.input']);
  });
});

describe('STAGE2の直接反映：入力欄への反映', () => {
  it('経営者の思いは、既存の文の末尾に追記し、既存の文を消さない', async () => {
    const state = setStore();
    allowAuthorize();
    const r = await applyStage2Op({ kind: 'ceo.append', text: '地域の暮らし' }, { settleMs: 0 });
    expect(r.ok).toBe(true);
    expect(state.ceoIntent).toBe('既存の思い\n地域の暮らし');
    expect(useAiHighlightStore.getState().target).toBe('stage2.ceoIntent');
  });

  it('ミッションを設定し、他の項目は変えない', async () => {
    const state = setStore({ vision: '既存のビジョン' });
    allowAuthorize();
    await applyStage2Op({ kind: 'mvv.set', field: 'mission', value: '地域を支える' }, { settleMs: 0 });
    expect(state.setMVV).toHaveBeenCalledWith({ mission: '地域を支える' });
    expect(state.vision).toBe('既存のビジョン');
    expect(useAiHighlightStore.getState().target).toBe('stage2.mvv');
  });

  it('SWOTの強みは、既存の行を残して末尾に追加する', async () => {
    const state = setStore();
    allowAuthorize();
    await applyStage2Op({ kind: 'swot.add', field: 'strength', text: '現場の改善力' }, { settleMs: 0 });
    expect(state.strength).toBe('A\n現場の改善力');
  });

  it('業績目標を追加し、同じ名前と年度の目標は二重に作らない', async () => {
    const state = setStore();
    allowAuthorize();
    const added = await applyStage2Op({ kind: 'target.add', label: '売上', unit: '万円', base: 8000, dueYear: 2030 }, { settleMs: 0 });
    expect(added.ok).toBe(true);
    const newTarget = state.companyTargets[1];
    expect(newTarget).toMatchObject({ label: '売上', unit: '万円', base: 8000, dueYear: 2030 });
    expect(typeof newTarget.id).toBe('string');
    expect(useAiHighlightStore.getState().target).toBe(`stage2.target.${newTarget.id}`);

    allowAuthorize();
    const dup = await applyStage2Op({ kind: 'target.add', label: '売上', unit: '万円', base: 9000, dueYear: 2030 }, { settleMs: 0 });
    expect(dup.ok).toBe(false);
    expect(state.companyTargets).toHaveLength(2);
  });

  it('業績目標の値は、同じ単位の時だけ修正する（ID・単位は保つ）', async () => {
    const state = setStore();
    allowAuthorize();
    await applyStage2Op({ kind: 'target.setBase', id: 't-1', label: '営業利益', unit: '万円', base: 6000 }, { settleMs: 0 });
    expect(state.companyTargets[0]).toEqual({ id: 't-1', label: '営業利益', unit: '万円', base: 6000 });
    allowAuthorize();
    const mismatch = await applyStage2Op({ kind: 'target.setBase', id: 't-1', label: '営業利益', unit: '百万円', base: 6 }, { settleMs: 0 });
    expect(mismatch.ok).toBe(false);
    expect(state.companyTargets[0].base).toBe(6000);
  });

  it('12の問いの回答は、質問IDで回答欄に入れ、質問を表示の対象にする', async () => {
    const state = setStore();
    allowAuthorize();
    await applyStage2Op({ kind: 'answer.set', questionId: 'ch1-q2', text: '紹介が多い' }, { settleMs: 0 });
    expect(state.answers12[0]).toMatchObject({ id: 'ch1-q2', answer: '紹介が多い' });
    expect(useAiHighlightStore.getState().target).toBe('stage2.question.ch1-q2');
  });
});

describe('STAGE2の直接反映：確認の途中の変化', () => {
  it('権限の確認中に同じ項目が変わっていれば、書き込まない', async () => {
    const state = setStore();
    global.fetch = jest.fn(async () => {
      state.ceoIntent = '手で書いた思い';
      return { ok: true, json: async () => ({ revision: 3 }) };
    }) as unknown as typeof fetch;
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u1' } } } });
    const r = await applyStage2Op({ kind: 'ceo.append', text: '地域の暮らし' }, { settleMs: 0 });
    expect(r.ok).toBe(false);
    expect(state.setCeoIntent).not.toHaveBeenCalled();
    expect(state.ceoIntent).toBe('手で書いた思い');
  });

  it('権限の確認中に利用者が切り替わっていれば、書き込まない', async () => {
    const state = setStore();
    allowAuthorize('u2');
    const r = await applyStage2Op({ kind: 'swot.add', field: 'threat', text: '人手不足' }, { settleMs: 0 });
    expect(r.ok).toBe(false);
    expect(state.setSWOT).not.toHaveBeenCalled();
  });
});
