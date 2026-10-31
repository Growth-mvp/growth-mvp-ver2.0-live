/* eslint-disable @typescript-eslint/no-explicit-any -- テスト用のストア状態の型をゆるく扱う */
export {};

const mockUser: any = { user: { id: 'user-1' }, companyId: 'c1', membershipVerified: true };
const mockFetchRow = jest.fn();

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => mockUser,
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/client', () => ({
  safeGetSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: (...args: unknown[]) => mockFetchRow(...args),
    saveStrategyData: jest.fn(async () => ({ ok: true })),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: () => 0,
    getFullStrategyDataByStrategyId: jest.fn(async () => ({ data: null, error: null })),
    deleteStrategyData: jest.fn(async () => ({ ok: true })),
  };
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useStrategyStore } from './strategyStore';
import { SwotOpportunityPanel } from '@/components/stage2/SwotOpportunityPanel';

const NOW = '2026-10-31T00:00:00.000Z';

/** 保存済みの行。候補一覧は、候補の追加より前に作られた古い形式（marketCategoryIds が無い）で持つ */
const savedRow = (opps: string[]) => ({
  companyId: 'c1',
  strategyId: 's1',
  revision: 1,
  opportunity: '確定した機会',
  threat: '確定した脅威',
  swotSuggestions: {
    opportunity: opps,
    threat: ['既存の脅威。'],
    generatedAt: NOW,
    insights: { opportunity: opps.map((text) => ({ text, basis: 'hypothesis', evidence: '', sourceIndex: null, group: 'existing_market' })), threat: [] },
    candidatePool: {
      version: 1,
      generatedAt: NOW,
      candidates: [
        ...opps.map((text) => ({
          id: `opp_${text.length}`,
          kind: 'opportunity',
          text,
          group: 'existing_market',
          basis: 'hypothesis',
          grounding: 'hypothesis_with_rationale',
          evidence: '',
          sourceIndex: null,
          sourceUrl: null,
          sourceLink: 'none',
          unverified: [],
          generatedAt: NOW,
        })),
        {
          id: 'thr_existing',
          kind: 'threat',
          text: '既存の脅威。',
          basis: 'hypothesis',
          grounding: 'hypothesis_with_rationale',
          evidence: '',
          sourceIndex: null,
          sourceUrl: null,
          sourceLink: 'none',
          unverified: [],
          generatedAt: NOW,
        },
      ],
      dropped: { opportunity: 0, threat: 0 },
      invalid: 0,
    },
  },
});

const OLD = ['古い機会が広がる可能性がある。'];
const NEW = ['新しい機会が広がる可能性がある。', '別の新しい機会が広がる可能性がある。'];

const get = () => useStrategyStore.getState() as any;

const generate = () =>
  get().setSwotSuggestions({
    opportunity: NEW,
    threat: ['新しい脅威。'],
    generatedAt: NOW,
    insights: {
      opportunity: NEW.map((text) => ({ text, basis: 'hypothesis', evidence: '', sourceIndex: null, group: 'new_region' })),
      threat: [],
    },
  });

describe('AI 生成の候補が、古い保存データの読み込みで消えない', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchRow.mockImplementation(async () => ({ data: savedRow(OLD), error: null }));
    useStrategyStore.setState({
      companyId: 'c1',
      strategyId: 's1',
      opportunity: '確定した機会',
      threat: '確定した脅威',
      swotSuggestions: undefined,
      dirty: false,
    } as any);
  });

  it('未保存の生成結果がある間に古い保存データが届いても、生成結果を残す', async () => {
    generate();
    expect(get().dirty).toBe(true);
    await get().refetchOnceFromServer();
    expect(get().swotSuggestions.opportunity).toEqual(NEW);
    expect(get().opportunity).toBe('確定した機会');
  });

  it('保存の後に届いた古い応答でも、取得の開始後に生成した候補を残す', async () => {
    let release: (v: unknown) => void = () => undefined;
    mockFetchRow.mockImplementation(() => new Promise((resolve) => (release = resolve)).then(() => ({ data: savedRow(OLD), error: null })));
    const pending = get().refetchOnceFromServer();
    await new Promise((r) => setTimeout(r, 0));
    generate();
    useStrategyStore.setState({ dirty: false } as any);
    release(null);
    await pending;
    expect(get().swotSuggestions.opportunity).toEqual(NEW);
  });

  it('生成も未保存の変更も無いときは、保存データをそのまま反映する', async () => {
    await get().refetchOnceFromServer();
    expect(get().swotSuggestions.opportunity).toEqual(OLD);
  });

  it('保存データの候補が古い形式でも、再読み込み後に候補一覧へ表示される', async () => {
    await get().refetchOnceFromServer();
    const s = get().swotSuggestions;
    const html = renderToStaticMarkup(
      createElement(SwotOpportunityPanel, {
        suggestions: s,
        locked: false,
        extending: false,
        extendMessage: null,
        extendError: null,
        onExtend: () => undefined,
        onAdd: () => undefined,
        onRemove: () => undefined,
        onEdit: () => undefined,
      })
    );
    expect(html).toContain(OLD[0]);
    expect(html).toContain('既存の脅威。');
  });
});

describe('利用者の操作は、保存と再読み込みの後も復活しない', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrategyStore.setState({
      companyId: 'c1',
      strategyId: 's1',
      opportunity: '',
      threat: '',
      swotSuggestions: undefined,
      dirty: false,
    } as any);
  });

  it('SWOT に追加して外した候補は、保存して読み直しても追加済みに戻らず、確定 SWOT にも入らない', async () => {
    get().setSwotSuggestions({ opportunity: OLD, threat: [], generatedAt: NOW });
    const target = get().swotSuggestions.candidatePool.candidates[0];
    get().addSwotCandidate(target.id);
    get().removeSwotOpportunity(target.text);
    const confirmedAfterRemove = get().opportunity;
    expect(confirmedAfterRemove).not.toContain(target.text);

    const saved = JSON.parse(JSON.stringify(get().swotSuggestions));
    mockFetchRow.mockImplementation(async () => ({
      data: { companyId: 'c1', strategyId: 's1', revision: 2, opportunity: confirmedAfterRemove, threat: '', swotSuggestions: saved },
      error: null,
    }));
    useStrategyStore.setState({ dirty: false } as any);
    await get().refetchOnceFromServer();

    expect(get().opportunity).toBe(confirmedAfterRemove);
    const html = renderToStaticMarkup(
      createElement(SwotOpportunityPanel, {
        suggestions: get().swotSuggestions,
        locked: false,
        extending: false,
        extendMessage: null,
        extendError: null,
        onExtend: () => undefined,
        onAdd: () => undefined,
        onRemove: () => undefined,
        onEdit: () => undefined,
      })
    );
    expect(html).toContain(target.text);
    expect(html).not.toContain('SWOTに追加済み');
  });

  it('意図的に空にした候補一覧は、機会・脅威の一覧から候補を復活させない', async () => {
    const emptied = { version: 1, generatedAt: NOW, candidates: [], dropped: { opportunity: 0, threat: 0 }, invalid: 0 };
    mockFetchRow.mockImplementation(async () => ({
      data: { companyId: 'c1', strategyId: 's1', revision: 3, opportunity: '', threat: '', swotSuggestions: { opportunity: OLD, threat: ['既存の脅威。'], generatedAt: NOW, candidatePool: emptied } },
      error: null,
    }));
    await get().refetchOnceFromServer();
    const html = renderToStaticMarkup(
      createElement(SwotOpportunityPanel, {
        suggestions: get().swotSuggestions,
        locked: false,
        extending: false,
        extendMessage: null,
        extendError: null,
        onExtend: () => undefined,
        onAdd: () => undefined,
        onRemove: () => undefined,
        onEdit: () => undefined,
      })
    );
    expect(html).not.toContain(OLD[0]);
    expect(html).not.toContain('既存の脅威。');
  });
});
