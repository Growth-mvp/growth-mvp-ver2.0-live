/* STAGE1 セグメントPL/BS の円確定（セグメントIDごと）をストア実体で確認する。Supabase 通信のみモック。 */
/* eslint-disable @typescript-eslint/no-explicit-any -- テストデータは型を緩くしている */
export {};

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => ({ user: null, companyId: null, membershipVerified: false }),
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    ...actual,
    getFullStrategyDataByCompany: jest.fn(async () => ({ data: null, error: null })),
    saveStrategyData: jest.fn(async () => ({ ok: true })),
  };
});

jest.mock('@/utils/supabase/client', () => ({
  safeGetSession: async () => ({ data: { session: null }, error: null }),
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
  isValidUUID: () => false,
}));

jest.mock('@/utils/persist/saveWithAudit', () => ({
  saveWithAudit: jest.fn(async () => ({ ok: true })),
}));

const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage.set(k, v);
    },
    removeItem: (k: string) => {
      memoryStorage.delete(k);
    },
    clear: () => memoryStorage.clear(),
    key: () => null,
    length: 0,
  },
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useStrategyStore } = require('./strategyStore') as typeof import('./strategyStore');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildFinanceCsvUnitMeta, buildStateFromDbRow } = require('@/utils/supabase/strategy') as typeof import('@/utils/supabase/strategy');

const SEG_A = { id: 'seg-a', name: 'A事業' };
const SEG_B = { id: 'seg-b', name: 'B事業' };
const PL_ROWS = [{ year: 2025, revenue: 5_000_000 }];
const BS_ROWS = [{ year: 2025, inventory: 40_000_000 }];

const store = () => useStrategyStore.getState() as any;

beforeEach(() => {
  useStrategyStore.setState({
    businessSegments: [SEG_A, SEG_B],
    segmentPL: { 'A事業': [], 'B事業': [] },
    segmentBS: { 'A事業': [], 'B事業': [] },
    financeUnitConfirmed: { pl: [], bs: false, segmentPL: [], segmentBS: [] },
    financeInputUnit: 'yen',
  } as any);
});

describe('セグメントPL/BSの円確定（セグメントごと・PLとBSを分けて管理）', () => {
  it('セグメントAのPL確定では、BのPLは未確定のまま', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    expect(store().financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
  });

  it('PL確定では、同じセグメントのBSは自動確定されない', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    expect(store().financeUnitConfirmed.segmentBS).toEqual([]);
  });

  it('セグメントAのBS確定では、BのBSは未確定のまま（PLの確定には影響しない）', () => {
    store().upsertSegmentBS('A事業', BS_ROWS);
    expect(store().financeUnitConfirmed.segmentBS).toEqual(['seg-a']);
    expect(store().financeUnitConfirmed.segmentPL).toEqual([]);
  });

  it('PLとBSの確定は、セグメントごとに別々に積み上がる', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    store().upsertSegmentBS('B事業', BS_ROWS);
    expect(store().financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(store().financeUnitConfirmed.segmentBS).toEqual(['seg-b']);
  });

  it('名称変更では、確定とデータが同じセグメントに残る', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    store().setProfile({ businessSegments: [{ ...SEG_A, name: 'A事業（改称）' }, SEG_B] });
    expect(store().financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(store().segmentPL['A事業（改称）']).toEqual(PL_ROWS);
    expect(store().segmentPL['A事業']).toBeUndefined();
  });

  it('セグメント削除では、その確定とデータを残さない', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    store().setProfile({ businessSegments: [SEG_B] });
    expect(store().financeUnitConfirmed.segmentPL).toEqual([]);
    expect(store().segmentPL['A事業']).toBeUndefined();
  });

  it('削除後に同じ名前で追加しても、前のセグメントの確定を引き継がない', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    store().setProfile({ businessSegments: [SEG_B] });
    store().setProfile({ businessSegments: [SEG_B, { id: 'seg-c', name: 'A事業' }] });
    expect(store().financeUnitConfirmed.segmentPL).toEqual([]);
    expect(store().segmentPL['A事業']).toEqual([]);
  });

  it('一括取込では、確定と宣言したセグメントだけを確定する', () => {
    store().setSegmentPL({ 'A事業': PL_ROWS, 'B事業': PL_ROWS }, ['A事業']);
    expect(store().financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
  });

  it('一括更新でも、データに残る既存の確定は保たれる', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    store().setSegmentPL({ 'A事業': PL_ROWS, 'B事業': PL_ROWS });
    expect(store().financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
  });

  it('一括更新でデータから外れたセグメントは、確定も外れる', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    store().setSegmentPL({ 'B事業': PL_ROWS });
    expect(store().financeUnitConfirmed.segmentPL).toEqual([]);
  });

  it('セグメントとして登録されていない名前は、確定しない', () => {
    store().upsertSegmentPL('未登録の事業', PL_ROWS);
    expect(store().financeUnitConfirmed.segmentPL).toEqual([]);
  });

  it('保存して再読込しても、確定は同じセグメントIDに残る', () => {
    store().upsertSegmentPL('A事業', PL_ROWS);
    const meta = buildFinanceCsvUnitMeta(store(), {});
    const reloaded = buildStateFromDbRow({ finance_pl: [], csv_finance_data: meta }) as any;
    expect(reloaded.financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(reloaded.financeUnitConfirmed.segmentBS).toEqual([]);
  });
});

describe('旧セグメント表（保存済みの数値）の表示・編集・保存', () => {
  const LEGACY_A = [
    { year: 2024, revenue: 500_000, operatingIncome: 20_000 },
    { year: 2025, revenue: 600_000, operatingIncome: 30_000 },
  ];
  const LEGACY_B = [{ year: 2025, revenue: 7_000, operatingIncome: 700 }];
  const LEGACY_BS_A = [{ year: 2024, ar: 100, inventory: 200, ap: 50, fixedAssets: 300, interestBearingDebt: 10, equity: 90 }];

  beforeEach(() => {
    useStrategyStore.setState({
      segmentPL: { 'A事業': LEGACY_A.map((r) => ({ ...r })), 'B事業': LEGACY_B.map((r) => ({ ...r })) },
      segmentBS: { 'A事業': LEGACY_BS_A.map((r) => ({ ...r })), 'B事業': [] },
    } as any);
  });

  it('保存済みの数値は換算せず、そのまま表示用の状態に保持される', () => {
    expect(store().segmentPL['A事業']).toEqual(LEGACY_A);
    expect(store().segmentPL['B事業']).toEqual(LEGACY_B);
    expect(store().segmentBS['A事業']).toEqual(LEGACY_BS_A);
  });

  it('1年度だけ変えて保存しても、他年度の保存値は変わらない', () => {
    const next = [LEGACY_A[0], { year: 2025, revenue: 1, operatingIncome: 2 }];
    store().upsertSegmentPL('A事業', next);
    expect(store().segmentPL['A事業']).toEqual(next);
    expect(store().segmentPL['A事業'][0]).toEqual(LEGACY_A[0]);
  });

  it('セグメントAの保存では、セグメントBの保存値は変わらず、Bは未確定のまま', () => {
    const bBefore = store().segmentPL['B事業'];
    store().upsertSegmentPL('A事業', [{ year: 2025, revenue: 9, operatingIncome: 9 }]);
    store().setSegmentPL({ 'A事業': [{ year: 2025, revenue: 9 }], 'B事業': store().segmentPL['B事業'] }, ['A事業']);
    expect(store().segmentPL['B事業']).toEqual(bBefore);
    expect(store().financeUnitConfirmed.segmentPL).not.toContain('seg-b');
  });

  it('PLを保存しても、同じセグメントのBSは確定されず、保存値も変わらない', () => {
    const bsBefore = store().segmentBS['A事業'];
    store().upsertSegmentPL('A事業', LEGACY_A);
    expect(store().financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(store().financeUnitConfirmed.segmentBS).toEqual([]);
    expect(store().segmentBS['A事業']).toEqual(bsBefore);
  });

  it('年度の追加・名称変更・削除と、セルの編集は、旧表でも行える', () => {
    store().addSegmentFinanceYear('A事業', 2026);
    expect(store().segmentPL['A事業'].some((r: any) => r.year === 2026)).toBe(true);
    expect(store().renameSegmentFinanceYear('A事業', 2024, 2023)).toBe(true);
    store().removeSegmentFinanceYear('A事業', 2025);
    expect(store().segmentPL['A事業'].some((r: any) => r.year === 2025)).toBe(false);
    store().updateSegmentPLCell('A事業', 2023, 'revenue', 9);
    expect(store().segmentPL['A事業'].find((r: any) => r.year === 2023).revenue).toBe(9);
  });

  it('名称変更でも、旧表の保存値は失われない', () => {
    store().setProfile({ businessSegments: [{ ...SEG_A, name: 'A事業（改称）' }, SEG_B] });
    expect(store().segmentPL['A事業（改称）']).toEqual(LEGACY_A);
    expect(store().segmentPL['A事業']).toBeUndefined();
  });

  it('再読込（F5）後も、保存済みの数値と確定状態が維持される', () => {
    store().upsertSegmentPL('A事業', LEGACY_A);
    const meta = buildFinanceCsvUnitMeta(store(), {});
    const reloaded = buildStateFromDbRow({
      finance_pl: [],
      csv_finance_data: { ...meta, segmentPL: store().segmentPL, segmentBS: store().segmentBS },
    }) as any;
    expect(reloaded.financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(reloaded.segmentPL['B事業']).toEqual(LEGACY_B);
    expect(reloaded.segmentBS['A事業']).toEqual(LEGACY_BS_A);
  });
});

describe('他STAGEの保存・再読込で、STAGE1の財務値が変わらない', () => {
  const LEGACY_A = [{ year: 2024, revenue: 500_000, operatingIncome: 20_000 }];

  beforeEach(() => {
    useStrategyStore.setState({
      segmentPL: { 'A事業': LEGACY_A.map((r) => ({ ...r })) },
      segmentBS: {},
      financePL: [{ year: 2024, revenue: 500_000 }],
      financeUnitConfirmed: { pl: [2024], bs: false, segmentPL: [], segmentBS: [] },
    } as any);
  });

  it('他STAGEの更新（会社BS・MVV）では、セグメントと会社PLの値は変わらない', () => {
    const segBefore = store().segmentPL;
    const plBefore = store().financePL;
    store().setFinanceBS([{ year: 2024, ar: 1 }] as any);
    store().setMVV({ mission: '検証' } as any);
    expect(store().segmentPL).toEqual(segBefore);
    expect(store().financePL).toEqual(plBefore);
  });

  it('読み込みは保存された行を書き換えない（表示のために既存DB値を変えない）', () => {
    const row = {
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: { segmentPL: { 'A事業': LEGACY_A.map((r) => ({ ...r })) }, segmentBS: {} },
    };
    const snapshot = JSON.parse(JSON.stringify(row));
    const state = buildStateFromDbRow(row) as any;
    expect(row).toEqual(snapshot);
    expect(state.segmentPL['A事業']).toEqual(LEGACY_A);
  });
});
