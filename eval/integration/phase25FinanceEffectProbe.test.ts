/* STAGE4 Phase 2.5：財務効果の正の情報源の検証（評価専用。本番DB・実OpenAIには接続しない）。
 * 純粋関数（lib/financeEffect・lib/okr/impactAdoption・mergeImpacts・normalizeStrategyData）は実物を呼ぶ。
 * 画面フック・ページ内にしかない式は「転記」として下に写し、出典行を注記している。アプリ本体は変更しない。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import {
  computeFinanceEffect,
  findFinanceEffectOverlapCandidates,
  financeEffectViewModel,
  normalizeFinanceEffect,
} from '@/lib/financeEffect';
import { adoptableImpact } from '@/lib/okr/impactAdoption';
import { mergeImpacts } from '@/utils/stage6/autoLinking';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

const OUT_DIR = path.join(__dirname, 'results-verify');
const M = 1_000_000;
const R: Record<string, any> = {};

beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));
afterAll(() => writeFileSync(path.join(OUT_DIR, 'phase25-finance-effect-probe.json'), JSON.stringify(R, null, 2), 'utf8'));

/* ---------- 転記（画面内にあり import できない式） ---------- */

/** 転記：app/okr/page.tsx:84-127 getImpactResultFromAssumptions */
function calcFromAssumptions(role: 'REVENUE' | 'COST' | 'FUTURE', a: Record<string, any>): number {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const round = (v: number) => Math.round(v * 10) / 10;
  if (role === 'REVENUE') return round(n(a.targetCustomers) * (n(a.conversionRatePct) / 100) * n(a.averageDealMJPY));
  if (role === 'COST') return round(n(a.currentCostMJPY) * (n(a.reductionRatePct) / 100));
  return round(n(a.peopleCount) * n(a.durationMonths) * n(a.monthlyCostPerPersonMJPY) + n(a.externalCostMJPY));
}

/** 転記：app/okr/page.tsx:2170-2190 updateImpactAssumptionsAndSave（既存値の確認なしに上書き） */
function assumptionWrite(current: Record<string, any>, patch: Record<string, any>) {
  const next = { ...(current.impactAssumptions ?? {}), ...patch };
  return { ...current, impactAssumptions: next, impactRevenueMJPY: calcFromAssumptions('REVENUE', next) };
}

/** 転記：components/okr/FinanceEffectSection.tsx:22,45-52 update（確認リセットはこの画面部品内のみ） */
const BASIS_FIELDS = ['kind', 'method', 'amountBasis', 'startYm', 'endYm', 'quantity', 'unitPriceYen', 'meetingsPerPeriod', 'winRatePct', 'averageDealYen', 'directAmountYen', 'costRatePct', 'sourceNote', 'scopeNote'];
function componentUpdate(current: Record<string, any>, patch: Record<string, any>) {
  const next = { ...current, ...patch };
  if (Object.keys(patch).some((k) => BASIS_FIELDS.includes(k))) {
    next.confirmed = false;
    delete next.confirmedAt;
  }
  return next;
}

/** 転記：app/okr/_hooks/useOkrEditor.ts:218-254 upsertImpact（manual・locked で北極星の行を作る） */
function stage6ImpactRow(projectId: string, targetId: string, delta: unknown) {
  const v = typeof delta === 'number' ? delta : Number(delta);
  if (!Number.isFinite(v)) return null;
  return { projectId, targetId, delta: v, source: 'manual', locked: true };
}

/** 転記：components/stage6/hooks/useStage6Data.ts:733 deltaRevenueTotal（表：下段） */
function tableRevenueDeltaMJPY(p: any): number {
  return typeof p.impactRevenueMJPY === 'number' && typeof p.impactRevenueProgress === 'number'
    ? (p.impactRevenueMJPY * p.impactRevenueProgress) / 100
    : 0;
}

/* ---------- 提案（未実装）：将来の統一試算で売上の採用値を決めるルール ---------- */
type Proposed = { source: string; valueMJPY: number; note?: string };
function proposedRevenue(p: any): Proposed {
  const fe = normalizeFinanceEffect(p.financeEffect);
  const r = computeFinanceEffect(fe);
  const legacy = typeof p.impactRevenueMJPY === 'number' ? p.impactRevenueMJPY : undefined;
  if (fe?.kind === 'NOT_FINANCIAL') {
    return { source: 'なし（財務換算しない）', valueMJPY: 0, note: legacy !== undefined ? '旧売上値は統一試算から外し、画面で警告' : undefined };
  }
  if (fe?.kind === 'REVENUE_UP' && r.status === 'CONFIRMED') {
    const annual = (r.annualRevenueYen ?? 0) / M;
    return {
      source: 'financeEffect（確認済み）',
      valueMJPY: annual,
      note: legacy !== undefined && legacy !== annual ? `旧値 ${legacy} と不一致：利用者に差を確認して移行` : undefined,
    };
  }
  if (fe?.kind === 'REVENUE_UP') {
    return { source: 'なし（未確認）', valueMJPY: 0, note: legacy !== undefined ? '旧値は候補表示のみ' : undefined };
  }
  if (fe) return { source: 'なし（売上以外の種類）', valueMJPY: 0 };
  return {
    source: legacy !== undefined ? 'なし（旧値のみ・未移行）' : 'なし',
    valueMJPY: 0,
    note: legacy !== undefined ? '旧値は利用者が financeEffect に移すまで統一試算に入れない（削除はしない）' : undefined,
  };
}

/* ---------- 観測 ---------- */
const DEPT = '営業部';
const TARGET_REV = 'rev-target';

function observe(project: Record<string, any>, extraProjects: Record<string, any>[] = []) {
  const raw = { departments: [{ id: 'd1', name: DEPT, projects: [project, ...extraProjects] }] };
  const loaded: any = normalizeStrategyData(JSON.parse(JSON.stringify(raw)));
  const q = loaded.departments[0].projects[0];
  const fe = normalizeFinanceEffect(q.financeEffect);
  const r = computeFinanceEffect(fe);
  const pid = `${DEPT}::${q.title}::0`;
  const row = stage6ImpactRow(pid, TARGET_REV, q.impactRevenueMJPY);
  const merged = mergeImpacts({ manual: row ? [row as any] : [], auto: [] });
  const chartAddedMJPY = merged.filter((m) => m.targetId === TARGET_REV).reduce((s, m) => s + (m.delta ?? 0), 0);
  return {
    保存値: {
      impactRevenueMJPY: q.impactRevenueMJPY ?? null,
      impactRevenueProgress: q.impactRevenueProgress ?? null,
      financeEffect: fe ? { kind: fe.kind, confirmed: fe.confirmed, annualRevenueMJPY: r.annualRevenueYen !== undefined ? r.annualRevenueYen / M : null } : null,
    },
    画面表示: {
      財務効果の状態: financeEffectViewModel(fe).statusLabel,
      旧売上欄: q.impactRevenueMJPY !== undefined ? `${q.impactRevenueMJPY}百万円（直接入力欄）` : '未入力',
    },
    北極星_現在: {
      上段_チャート加算_最終年: chartAddedMJPY,
      下段_表の売上寄与: tableRevenueDeltaMJPY(q),
      financeEffectの寄与: 0,
    },
    統一試算_提案: proposedRevenue(q),
  };
}

describe('STAGE4 Phase 2.5 財務効果の正の情報源（架空企業）', () => {
  it('A：旧金額1000万円・新financeEffect2000万円は二つの値として並存する', () => {
    const o = observe({
      title: '新規開拓A', role: 'REVENUE', impactRevenueMJPY: 10, impactRevenueProgress: 50,
      financeEffect: { kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 20 * M, amountBasis: 'ANNUAL', startYm: '2027-04', sourceNote: '架空の算定根拠', source: 'USER_INPUT', confirmed: true, confirmedAt: '2026-11-01T00:00:00.000Z' },
    });
    R['A_旧1000万_新2000万'] = o;
    expect(o.保存値.impactRevenueMJPY).toBe(10);
    expect(o.保存値.financeEffect?.annualRevenueMJPY).toBe(20);
    expect(o.北極星_現在.上段_チャート加算_最終年).toBe(10);
    expect(o.北極星_現在.下段_表の売上寄与).toBe(5);
    expect(o.統一試算_提案.valueMJPY).toBe(20);
    expect(o.統一試算_提案.note).toContain('不一致');
  });

  it('B：financeEffect 未確認（DRAFT）は、統一試算に入らない', () => {
    const o = observe({
      title: '新規開拓B', role: 'REVENUE', impactRevenueMJPY: 10, impactRevenueProgress: 50,
      financeEffect: { kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 20 * M, amountBasis: 'ANNUAL', startYm: '2027-04', sourceNote: '架空', source: 'USER_INPUT', confirmed: false },
    });
    R['B_未確認'] = o;
    expect(o.画面表示.財務効果の状態).toBe('未確定（確認待ち）');
    expect(o.統一試算_提案.valueMJPY).toBe(0);
    expect(o.統一試算_提案.source).toBe('なし（未確認）');
  });

  it('C：確認後に金額を変えると確認が外れ、未確認に戻る（画面部品経由のみ）', () => {
    const confirmed = { kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 20 * M, amountBasis: 'ANNUAL', startYm: '2027-04', sourceNote: '架空', source: 'USER_INPUT', confirmed: true, confirmedAt: '2026-11-01T00:00:00.000Z' };
    const edited = componentUpdate(confirmed, { directAmountYen: 25 * M });
    const o = observe({ title: '新規開拓C', role: 'REVENUE', impactRevenueMJPY: 10, impactRevenueProgress: 50, financeEffect: edited });
    const unreset = { ...confirmed, directAmountYen: 25 * M };
    R['C_確認後に変更'] = { ...o, 参考_確認リセットされない経路: { 状態: computeFinanceEffect(unreset).status, 年額売上MJPY: computeFinanceEffect(unreset).annualRevenueYen! / M } };
    expect(edited.confirmed).toBe(false);
    expect(o.統一試算_提案.valueMJPY).toBe(0);
    expect(computeFinanceEffect(unreset).status).toBe('CONFIRMED');
  });

  it('D：財務換算しない施策でも、旧売上欄の値は北極星へ残る（不整合）', () => {
    const o = observe({
      title: '新規開拓D', role: 'REVENUE', impactRevenueMJPY: 10, impactRevenueProgress: 50,
      financeEffect: { kind: 'NOT_FINANCIAL', source: 'USER_INPUT', confirmed: false },
    });
    R['D_財務換算しない'] = o;
    expect(o.画面表示.財務効果の状態).toBe('財務換算しない施策');
    expect(o.北極星_現在.上段_チャート加算_最終年).toBe(10);
    expect(o.統一試算_提案.valueMJPY).toBe(0);
  });

  it('E：同じ施策の重複候補を検出し、自動では除外しない', () => {
    const fe = (o: Record<string, any>) => ({
      kind: 'REVENUE_UP', method: 'FUNNEL', meetingsPerPeriod: 3, winRatePct: 20, averageDealYen: 10 * M,
      amountBasis: 'MONTHLY', sourceNote: '架空', source: 'USER_INPUT', confirmed: true, confirmedAt: '2026-11-01T00:00:00.000Z', ...o,
    });
    const departments = [{
      name: DEPT,
      projects: [
        { title: '新規開拓（首都圏）', financeEffect: fe({ startYm: '2027-04', endYm: '2028-03', scopeNote: '首都圏' }) },
        { title: '既存深耕（首都圏）', financeEffect: fe({ startYm: '2027-10', scopeNote: '首都圏' }) },
        { title: '紹介制度（全国）', financeEffect: fe({ startYm: '2028-01', endYm: '2028-12', scopeNote: '全国' }) },
        { title: '原価削減', financeEffect: { kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 5 * M, amountBasis: 'ANNUAL', startYm: '2027-04', sourceNote: '架空', source: 'USER_INPUT', confirmed: true } },
      ],
    }];
    const candidatesOf0 = findFinanceEffectOverlapCandidates(departments, 0, 0);
    const candidatesOf2 = findFinanceEffectOverlapCandidates(departments, 0, 2);
    const naiveSumMJPY = Math.round(([0, 1, 2].reduce((s, i) => s + (computeFinanceEffect(normalizeFinanceEffect(departments[0].projects[i].financeEffect)).annualRevenueYen ?? 0), 0) / M) * 1000) / 1000;
    R['E_重複候補'] = {
      候補_新規開拓: candidatesOf0,
      候補_紹介制度: candidatesOf2,
      単純合計_売上年額MJPY: naiveSumMJPY,
      注: '候補は表示のみ。単純合計は重複を除いていない値（統一試算では使用禁止）',
    };
    expect(candidatesOf0).toEqual(['営業部 / 既存深耕（首都圏）', '営業部 / 紹介制度（全国）']);
    expect(candidatesOf2).toEqual(['営業部 / 新規開拓（首都圏）', '営業部 / 既存深耕（首都圏）']);
    expect(naiveSumMJPY).toBe(72 * 3);
  });

  it('F：旧データのみ（financeEffect なし）は未設定扱いで、旧値は北極星に残る', () => {
    const o = observe({
      title: '新規開拓F', role: 'REVENUE', impactRevenueMJPY: 120, impactRevenueProgress: 50,
      impactAssumptions: { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 },
    });
    R['F_旧データのみ'] = o;
    expect(o.保存値.financeEffect).toBeNull();
    expect(o.画面表示.財務効果の状態).toBe('未設定（任意）');
    expect(o.北極星_現在.上段_チャート加算_最終年).toBe(120);
    expect(o.統一試算_提案.valueMJPY).toBe(0);
  });
});

describe('自動書き込みの条件（AI反映・前提編集・プリセット）', () => {
  it('AI案の反映は、既存の値があれば上書きしない。前提編集・プリセットは無条件に上書きする', () => {
    const aiOverSet = adoptableImpact({ role: 'REVENUE', draftImpact: { revenueMJPY: 30 }, calculatedValue: 120, current: { impactRevenueMJPY: 10 } });
    const aiEmpty = adoptableImpact({ role: 'REVENUE', draftImpact: { revenueMJPY: 30 }, calculatedValue: 120, current: {} });

    const current = { impactRevenueMJPY: 10, impactAssumptions: { conversionRatePct: 20, averageDealMJPY: 20 } };
    const editedTarget = assumptionWrite(current, { targetCustomers: 30 });
    const editedEmpty = assumptionWrite(current, { targetCustomers: undefined });
    const preset = assumptionWrite(current, { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 });

    R['自動書き込み'] = {
      AI案反映_既存値あり: aiOverSet,
      AI案反映_空欄: aiEmpty,
      前提編集_targetCustomersを30に: { 直前: 10, 書き込み後: editedTarget.impactRevenueMJPY },
      前提編集_targetCustomersを空欄に: { 直前: 10, 書き込み後: editedEmpty.impactRevenueMJPY },
      プリセット_標準: { 直前: 10, 書き込み後: preset.impactRevenueMJPY },
    };
    expect(aiOverSet.kind).toBe('already_set');
    expect(aiEmpty).toEqual({ kind: 'adoptable', field: 'impactRevenueMJPY', value: 120 });
    expect(editedTarget.impactRevenueMJPY).toBe(120);
    expect(editedEmpty.impactRevenueMJPY).toBe(0);
    expect(preset.impactRevenueMJPY).toBe(120);
  });
});

describe('財務効果の意味（売上・営業利益・投資・費用を混ぜない）', () => {
  it('売上増は売上のみ、コスト削減は営業利益のみ、追加費用は符号が負、原価率は利益へ差し引かない', () => {
    const rev = computeFinanceEffect({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 20 * M, amountBasis: 'ANNUAL', startYm: '2027-04', sourceNote: 'x', source: 'USER_INPUT', confirmed: true, costRatePct: 40 });
    const cut = computeFinanceEffect({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 5 * M, amountBasis: 'ANNUAL', startYm: '2027-04', sourceNote: 'x', source: 'USER_INPUT', confirmed: true });
    const add = computeFinanceEffect({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 3 * M, amountBasis: 'TOTAL', startYm: '2027-04', sourceNote: 'x', source: 'USER_INPUT', confirmed: true });
    const monthly = computeFinanceEffect({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 2 * M, amountBasis: 'MONTHLY', startYm: '2027-04', sourceNote: 'x', source: 'USER_INPUT', confirmed: true });
    R['意味_区別'] = {
      売上増_年額: { 売上: rev.annualRevenueYen! / M, 営業利益効果: rev.annualOperatingEffectYen ?? null, 参考原価: rev.referenceCostYen! / M },
      原価削減_年額: { 売上: cut.annualRevenueYen ?? null, 営業利益効果: cut.annualOperatingEffectYen! / M },
      追加費用_一回限り: { 営業利益効果: add.oneTimeOperatingEffectYen! / M, 総額: add.totalYen! / M },
      売上増_月額2百万: { 年額売上: monthly.annualRevenueYen! / M, 月額: monthly.monthlyYen! / M },
      年度配分: '未実装。computeFinanceEffect は年額・月額を返すのみで、年度（fiscalYearEnd）への按分は行わない',
    };
    expect(rev.annualOperatingEffectYen).toBeUndefined();
    expect(rev.referenceCostYen).toBe(8 * M);
    expect(cut.annualRevenueYen).toBeUndefined();
    expect(cut.annualOperatingEffectYen).toBe(5 * M);
    expect(add.oneTimeOperatingEffectYen).toBe(-3 * M);
    expect(monthly.annualRevenueYen).toBe(24 * M);
  });
});
