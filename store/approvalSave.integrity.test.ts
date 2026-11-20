/* 承認→保存の整合性：保存済みの行を模したデータ（合成）をストアへ読み込み、取り込み候補の一部だけを承認して保存したとき、
 * 保存される更新内容が承認した項目だけを変えることを確かめる。Supabase 通信のみモック（本番には接続しない）。 */

export {};

const SID = '175965d2-9419-4b3b-bd72-efd06848f1e0';
const CID = 'ea055d3b-3661-4bf5-aadf-689841a74f76';
const UID = 'user-1';

const mockDb: {
  rows: Record<string, any[]>;
  updates: Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>;
} = { rows: {}, updates: [] };

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => ({ user: { id: 'user-1' }, companyId: 'ea055d3b-3661-4bf5-aadf-689841a74f76', membershipVerified: true }),
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/client', () => {
  const rowsOf = (table: string, filters: Array<[string, unknown]>) =>
    (mockDb.rows[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let pending: { op: 'select' | 'update'; payload?: Record<string, unknown> } = { op: 'select' };
    const result = () => {
      if (pending.op === 'update') {
        mockDb.updates.push({ table, payload: pending.payload as Record<string, unknown>, filters: [...filters] });
        const cur = rowsOf(table, filters)[0];
        return cur ? { ...cur, ...pending.payload, revision: (cur.revision ?? 0) + 1 } : null;
      }
      return rowsOf(table, filters);
    };
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return api;
      },
      order: () => api,
      limit: () => api,
      update: (p: Record<string, unknown>) => {
        pending = { op: 'update', payload: p };
        return api;
      },
      insert: () => api,
      delete: () => api,
      maybeSingle: async () => {
        const r = result();
        return { data: Array.isArray(r) ? r[0] ?? null : r, error: null };
      },
      single: async () => {
        const r = result();
        return { data: Array.isArray(r) ? r[0] ?? null : r, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const r = result();
        return Promise.resolve({ data: r, error: null }).then(resolve, reject);
      },
    };
    return api;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      rpc: async () => ({ data: null, error: null }),
    },
    getCompanyIdFromCookie: () => 'ea055d3b-3661-4bf5-aadf-689841a74f76',
    setCompanyIdCookie: () => {},
  };
});

import { useStrategyStore, buildSavePayload } from '@/store/strategyStore';
import { buildStateFromDbRow, saveStrategyData } from '@/utils/supabase/strategy';
import { planFilingApply, type CurrentFilingProfile } from '@/lib/autofill/filingCandidates';
import { combineFinance, splitFinanceWrite, summaryFollowsPL } from '@/lib/autofill/financeWrite';
import { buildDocumentCandidate } from '@/lib/autofill/publicCandidate';
import { PDF_IMPORT_RESPONSE } from '@/lib/autofill/__fixtures__/pdfImportResponse';

/** 保存済みの行を模した合成データ（本番の値ではない）。列名は保存対象の列と同じ */
function syntheticSavedRow(): Record<string, any> {
  const answers12 = Array.from({ length: 12 }, (_, i) => ({ id: `ch${Math.floor(i / 3)}-q${(i % 3) + 1}`, answer: '' }));
  return {
    id: SID,
    company_id: CID,
    user_id: UID,
    updated_by: UID,
    created_at: '2026-01-01T00:00:00.000000',
    updated_at: '2026-11-19T05:21:49.936038',
    revision: 356,
    company_name: 'テスト株式会社',
    foundation_year: '1990',
    location: '',
    industry: 'logistics',
    revenue: '',
    employees: '20〜49',
    business_content: '合成の事業内容',
    customer_segment: '',
    strength: '強み（合成）',
    weakness: '',
    opportunity: '',
    threat: '',
    mission: '',
    vision: '',
    value: '',
    thought: '',
    ceo_intent: '',
    email: null,
    role: null,
    departments: [],
    story: [],
    story_draft: [],
    final_story: [],
    final_story_draft: [],
    final_story_edited: [],
    final_story_final: [],
    strategy_summary: null,
    editable_cascade: null,
    answers2: [],
    answers12,
    win_patterns_candidate: null,
    win_patterns: null,
    win_pattern_primary: null,
    win_pattern_secondary: null,
    company_targets: [],
    project_target_impacts: [],
    project_issue_links: [],
    okr_target_scores: {},
    execution_plans: null,
    simulation_results: [],
    stage1_issues: [],
    stage1_benchmarks: null,
    swot_suggestions: {},
    stage2_final_document_edits: {},
    stage3_strategy_bridge: {},
    final_story_conclusion: {},
    business_portfolio: {},
    finance_summary: {},
    business_segments: [{ id: 'seg-1', name: '新聞販売・配達事業', revenue: 100, profit: 5 }],
    finance_pl: [
      { year: 2021, revenue: 100, operatingIncome: 10, netIncome: 5 },
      { year: 2022, revenue: 110, operatingIncome: 11, netIncome: 6 },
      { year: 2023, revenue: 120, operatingIncome: 12, netIncome: 7 },
      { year: 2024, revenue: null, operatingIncome: 20, netIncome: 10 },
    ],
    csv_finance_data: {
      financeBS: [
        { year: 2021, totalAssets: 300, netAssets: 150 },
        { year: 2022, totalAssets: 310, netAssets: 155 },
        { year: 2023, totalAssets: 320, netAssets: 160 },
        { year: 2024, totalAssets: null, netAssets: null },
      ],
      segmentPL: { '新聞販売・配達事業': [{ year: 2024, revenue: 100, operatingIncome: 5 }] },
      segmentBS: {},
      financeUnitConfirmed: { pl: [2021, 2022, 2023, 2024], bs: true, segmentPL: [], segmentBS: [] },
    },
    fiscal_year_end: '3',
    currency: 'JPY',
    period_start_year: null,
    period_end_year: null,
    is_listed: false,
    ticker: '',
    pbr_manual: '',
  };
}

/** 比較用：値を正規化した木構造の葉を、パスと値の組で列挙する（配列は year / id / name で対応づける） */
function leaves(v: any, path = '', out: Map<string, string> = new Map()): Map<string, string> {
  if (Array.isArray(v)) {
    if (v.length === 0) out.set(path, '[]');
    v.forEach((item, i) => {
      const key =
        item && typeof item === 'object' && 'year' in item ? `year=${item.year}` : item && typeof item === 'object' && 'id' in item ? `id=${item.id}` : `${i}`;
      leaves(item, `${path}[${key}]`, out);
    });
  } else if (v && typeof v === 'object') {
    if (Object.keys(v).length === 0) out.set(path, '{}');
    for (const k of Object.keys(v).sort()) leaves(v[k], path ? `${path}.${k}` : k, out);
  } else if (typeof v === 'number') {
    out.set(path, JSON.stringify(String(v)));
  } else if (v !== undefined) {
    out.set(path, JSON.stringify(v));
  }
  return out;
}

/** 保存前後の差分（パスごとの「前→後」） */
function diffRows(before: Record<string, any>, after: Record<string, any>): Map<string, string> {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  for (const col of Object.keys(after)) {
    for (const [k, v] of leaves(before[col], col)) a.set(k, v);
    for (const [k, v] of leaves(after[col], col)) b.set(k, v);
  }
  const out = new Map<string, string>();
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(k) !== b.get(k)) out.set(k, `${a.get(k) ?? '(なし)'} → ${b.get(k) ?? '(なし)'}`);
  }
  return out;
}

async function approveOneItemAndSave(rowsFor: (row: Record<string, any>) => Record<string, any>[] = (row) => [row]) {
  const row = syntheticSavedRow();
  // 保存済みの行は、アプリが書いた正規化済みの形（質問文・必須フラグ付き）になっている
  row.answers12 = JSON.parse(JSON.stringify((buildStateFromDbRow(row) as any).answers12));
  mockDb.rows = { strategy_data: rowsFor(row), company_members: [{ company_id: CID, user_id: UID, role: 'manager' }] };
  mockDb.updates = [];

  useStrategyStore.setState({
    ...(buildStateFromDbRow(row) as any),
    companyId: CID,
    strategyId: SID,
    revision: 356,
    loaded: true,
    hydrated: true,
    dirty: false,
  } as any);

  const candidate = buildDocumentCandidate({
    candidates: PDF_IMPORT_RESPONSE.candidates as any,
    profiles: PDF_IMPORT_RESPONSE.documentProfiles.map((p) => p.profile),
    fetchedAt: 'T',
  });
  if (candidate.status !== 'FOUND') throw new Error('candidate');

  // 承認の手順（CompanyAutofillPanel と同じ関数）：所在地の1項目と、2024年度の空欄だけを承認する
  const s0 = useStrategyStore.getState() as any;
  const current: CurrentFilingProfile = {
    companyName: s0.companyName ?? '',
    ticker: String(s0.ticker ?? ''),
    fiscalYearEnd: String(s0.fiscalYearEnd ?? ''),
    isListed: s0.isListed,
    location: s0.location ?? '',
    employees: String(s0.employees ?? ''),
    businessContent: s0.businessContent ?? '',
    industry: s0.industry ?? '',
  };
  const pl = (s0.financePL ?? []) as any[];
  const bs = (s0.financeBS ?? []) as any[];
  const plan = planFilingApply({
    current,
    currentFinance: combineFinance(pl, bs),
    candidate: candidate.candidate,
    selectedProfile: ['location'],
    overwriteProfile: [],
    selectedYears: [2024],
    overwriteYears: [],
    selectedSegments: false,
    overwriteSegments: false,
    currentSegmentCount: (s0.businessSegments ?? []).length,
  });
  const profileWrite = { ...plan.profilePatch } as Record<string, unknown>;
  if (Object.keys(profileWrite).length > 0) useStrategyStore.getState().setProfile(profileWrite as any);
  const written = splitFinanceWrite(plan, pl as any, bs as any);
  if (written.pl) {
    useStrategyStore.getState().setFinancePL(written.pl as any);
    const summary = summaryFollowsPL((s0 as any).financeSummary, pl, written.pl);
    if (summary) useStrategyStore.getState().setFinanceSummary(summary as any);
  }
  if (written.bs) useStrategyStore.getState().setFinanceBS(written.bs as any);

  // 保存：ストアの状態から保存用ペイロードを作り、保存関数（実物）に渡す
  const payload = buildSavePayload(useStrategyStore.getState() as any);
  const res: any = await saveStrategyData(payload as any, UID, CID, 356, { mode: 'upsert' });
  const update = mockDb.updates.find((u) => u.table === 'strategy_data');
  return { row, plan, update, res, payload };
}

describe('承認→保存：承認していない項目・年度・セグメントは変わらない（モック）', () => {
  it('保存の更新は戦略IDと企業ID、revision（楽観ロック）で1行だけを対象にする', async () => {
    const { update } = await approveOneItemAndSave();
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(expect.arrayContaining([['company_id', CID], ['id', SID], ['revision', 356]]));
  });

  it('承認した所在地と2024年度の空欄以外に、保存される差分がない', async () => {
    const { row, update } = await approveOneItemAndSave();
    // 送信内容は JSON に直してから比べる（undefined の項目は保存されない）
    const sent = JSON.parse(JSON.stringify(update!.payload));
    const after = { ...row, ...sent };
    const diff = diffRows(row, after);
    const keys = [...diff.keys()];
    // 承認で意図した変更：所在地・2024年度の売上と貸借（空欄だった項目）・更新日時（DBのトリガー）・派生の財務要約
    const allowed = [
      /^updated_at$/,
      /^location$/,
      /^finance_pl\[year=2024\]\.revenue$/,
      /^csv_finance_data\.financeBS\[year=2024\]\.(totalAssets|netAssets)$/,
      /^finance_summary$/,
      /^finance_summary\.rows\[/,
    ];
    // 空の回答（""）は保存時に省略される（未回答と同じ意味）。空以外の回答が変わることは許さない
    const emptyAnswerOmitted = (k: string) => /^answers12\[id=[^\]]+\]\.answer$/.test(k) && diff.get(k) === '"" → (なし)';
    const unexpected = keys.filter((k) => !allowed.some((re) => re.test(k)) && !emptyAnswerOmitted(k));
    expect({ unexpected, changed: Object.fromEntries(diff) }).toEqual({ unexpected: [], changed: expect.any(Object) });
  });

  it('派生の財務要約は、保存した財務行の値と一致する（他の値を混ぜない）', async () => {
    const { update } = await approveOneItemAndSave();
    const sent = JSON.parse(JSON.stringify(update!.payload));
    const pl = new Map<number, any>((sent.finance_pl as any[]).map((r) => [r.year, r]));
    const rows = (sent.finance_summary?.rows ?? []) as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const p = pl.get(r.year);
      expect(p).toBeDefined();
      expect(r.revenue).toBe(p.revenue);
      expect(r.operatingIncome).toBe(p.operatingIncome);
      expect(r.netIncome).toBe(p.netIncome);
    }
  });

  it('他社（別の企業ID）の行・他の戦略は、保存の対象にも内容にも入らない', async () => {
    const { row, update } = await approveOneItemAndSave();
    expect(update!.filters).toEqual(expect.arrayContaining([['company_id', CID]]));
    const sent = JSON.parse(JSON.stringify(update!.payload));
    expect(sent.company_id === undefined || sent.company_id === CID).toBe(true);
    expect(JSON.stringify(sent)).not.toContain('別の企業');
    expect(sent.company_name).toBe(row.company_name);
  });
});

describe('保存先の特定：既存行のIDが不明・戦略行が複数ある場合は保存を拒否する', () => {
  it('既存行にIDが無いときは、企業IDだけで更新せず、保存を拒否する', async () => {
    const { update, res } = await approveOneItemAndSave((row) => [{ ...row, id: undefined }]);
    expect(update).toBeUndefined();
    expect(res.error?.code).toBe('SAVE_ROW_ID_UNKNOWN');
  });

  it('同じ企業の戦略行が2件以上あるときは、どちらにも保存せず拒否する', async () => {
    const { update, res } = await approveOneItemAndSave((row) => [row, { ...row, id: '00000000-0000-4000-8000-000000000002' }]);
    expect(update).toBeUndefined();
    expect(res.error?.code).toBe('SAVE_MULTIPLE_ROWS');
  });
});
