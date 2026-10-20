import { readFileSync } from 'fs';
import path from 'path';
import { buildCashFlowPlan, type CashFlowInput, type CfAssumptions } from './cashflow';
import { buildDebtSchedule, type ExistingLoanInput, type NewLoanInput } from './debt';
import {
  FINANCE_PLAN_CALC_VERSION,
  canRestoreFor,
  describeSaveError,
  freshnessLabel,
  hashOf,
  judgeFreshness,
  parseSavedFinancePlan,
  applyWorkingSnapshot,
  financePlanUnsaved,
  pickFinancePlanForSave,
  workingHashOf,
  buildStoredFinancePlan,
  readStoredFinancePlan,
  saveAvailability,
  sourceHashOf,
  toSavedFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
  type SourceSummary,
} from './financePlanSnapshot';

const assumptions: CfAssumptions = {
  minCashYen: 200_000_000,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: 0.15,
  inventoryRatio: null,
  apRatio: 0,
  targetRevenueYen: 1_200_000_000,
  targetOperatingIncomeYen: null,
  targetYear: 2027,
};

const existingLoans: ExistingLoanInput[] = [
  {
    id: 'e1',
    name: '既存A',
    category: 'BANK',
    balanceYen: 100_000_000,
    annualRate: 0.05,
    scheduledPrincipalYen: { 2026: 10_000_000, 2027: null, 2028: 0 },
  },
];

const newLoans: NewLoanInput[] = [
  {
    id: 'n1',
    name: '新規B',
    drawYear: 2026,
    drawMonth: null,
    amountYen: 200_000_000,
    annualRate: 0.02,
    termYears: 3,
    graceYears: 1,
    method: 'EQUAL_PRINCIPAL',
  },
];

const dividendsYen = { 2026: 0, 2027: null, 2028: 5_000_000 };

const domain: FinancePlanDomain = { assumptions, existingLoans, newLoans, dividendsYen };

const pl = [
  { year: 2024, revenue: 900_000_000, operatingIncome: 80_000_000, interest: 4_000_000, tax: 20_000_000, netIncome: 56_000_000, depreciation: 18_000_000 },
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000, interest: 5_000_000, tax: 28_500_000, netIncome: 66_500_000, depreciation: 20_000_000 },
];
const bs = [
  { year: 2024, cash: 250_000_000, ar: 135_000_000, inventory: 72_000_000, ap: 81_000_000, interestBearingDebt: 110_000_000 },
  { year: 2025, cash: 300_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 90_000_000, interestBearingDebt: 100_000_000 },
];
const investment = {
  approvedReadyYen: 0,
  unapprovedReadyYen: 1_000_000,
  unclassifiedYen: 0,
  unscheduledYen: 0,
  candidateYen: 0,
  basisPendingYen: 0,
  yearlyByCategory: [{ fiscalYear: 2026, CAPEX: 30_000_000, OPEX: 0, OTHER: 0 }],
};
const source: SourceSummary = { financePL: pl, financeBS: bs, investment };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

describe('CF前提の保存・復元', () => {
  it('CF前提はJSON往復後も同じ値に戻る', () => {
    const saved = JSON.parse(JSON.stringify(toSavedFinancePlan(domain)));
    const parsed = parseSavedFinancePlan(saved);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.assumptions).toEqual(assumptions);
  });

  it('年度別売上・営業利益の推計条件と目標年度を保持する', () => {
    const saved = toSavedFinancePlan(domain);
    expect(saved.cashFlow.targetRevenueYen).toBe(1_200_000_000);
    expect(saved.cashFlow.targetYear).toBe(2027);
  });
});

describe('既存借入・新規借入・配当の保存と復元', () => {
  it('既存借入明細（ID・名称・区分・残高・金利・年度別返済）を保持する', () => {
    const parsed = parseSavedFinancePlan(JSON.parse(JSON.stringify(toSavedFinancePlan(domain))));
    if (!parsed.ok) throw new Error('parse failed');
    const expected = existingLoans[0];
    expect(parsed.value.existingLoans[0]).toEqual({
      ...expected,
      scheduledPrincipalYen: Object.fromEntries(
        Object.entries(expected.scheduledPrincipalYen).filter(([, v]) => v !== null),
      ),
    });
  });

  it('新規借入明細（実行年月・金額・金利・期間・据置・返済方式）を保持する', () => {
    const parsed = parseSavedFinancePlan(JSON.parse(JSON.stringify(toSavedFinancePlan(domain))));
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.value.newLoans[0]).toEqual(newLoans[0]);
  });

  it('配当予定を保持し、未入力（null）と0を区別する', () => {
    const parsed = parseSavedFinancePlan(JSON.parse(JSON.stringify(toSavedFinancePlan(domain))));
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.value.dividendsYen[2026]).toBe(0);
    expect(parsed.value.dividendsYen[2027] ?? null).toBeNull();
    expect(parsed.value.dividendsYen[2028]).toBe(5_000_000);
  });

  it('年度別の返済条件（複数年度）を保持し、年度の未入力は未入力のまま', () => {
    const parsed = parseSavedFinancePlan(JSON.parse(JSON.stringify(toSavedFinancePlan(domain))));
    if (!parsed.ok) throw new Error('parse failed');
    const sched = parsed.value.existingLoans[0].scheduledPrincipalYen;
    expect(sched[2026]).toBe(10_000_000);
    expect(sched[2027] ?? null).toBeNull();
    expect(sched[2028]).toBe(0);
    expect(sched[2029]).toBeUndefined();
  });

  it('借入の実行月が未入力なら未入力のまま保存する（1月と仮定しない）', () => {
    const saved = toSavedFinancePlan(domain);
    expect(saved.newLoans[0].drawMonth ?? null).toBeNull();
  });
});

describe('0と未入力、金額単位', () => {
  it('明示的な0と未入力（null）を区別して保持する', () => {
    const parsed = parseSavedFinancePlan(JSON.parse(JSON.stringify(toSavedFinancePlan(domain))));
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.value.assumptions.depreciationYen).toBeNull();
    expect(parsed.value.assumptions.apRatio).toBe(0);
  });

  it('金額は円（JPY）で保存し、単位の宣言がない・別単位の保存データは復元しない', () => {
    const saved = toSavedFinancePlan(domain);
    expect(saved.unit).toBe('JPY');
    expect(saved.cashFlow.minCashYen).toBe(200_000_000);
    expect(parseSavedFinancePlan({ ...saved, unit: undefined }).ok).toBe(false);
    expect(parseSavedFinancePlan({ ...saved, unit: 'MILLION_YEN' }).ok).toBe(false);
  });

  it('数値でない値は0にせず未入力として扱い、警告を返す', () => {
    const saved = JSON.parse(JSON.stringify(toSavedFinancePlan(domain)));
    saved.cashFlow.minCashYen = '200000000';
    const parsed = parseSavedFinancePlan(saved);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.value.assumptions.minCashYen).toBeNull();
    expect(parsed.warnings.some((w) => w.includes('minCashYen'))).toBe(true);
  });
});

describe('後方互換性', () => {
  it('セクションが欠けた古い保存データは空の入力として読み込む', () => {
    const parsed = parseSavedFinancePlan({ formatVersion: 1, unit: 'JPY' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.existingLoans).toEqual([]);
    expect(parsed.value.newLoans).toEqual([]);
    expect(parsed.value.dividendsYen).toEqual({});
    expect(parsed.value.assumptions.minCashYen).toBeNull();
  });

  it('未知の形式バージョンは復元しない', () => {
    expect(parseSavedFinancePlan({ formatVersion: 2, unit: 'JPY' }).ok).toBe(false);
    expect(parseSavedFinancePlan(null).ok).toBe(false);
  });

  it('未知のフィールドがあっても読み込みを妨げない', () => {
    const saved = { ...toSavedFinancePlan(domain), futureField: { x: 1 } };
    expect(parseSavedFinancePlan(saved).ok).toBe(true);
  });

  it('区分・返済方式が不明な明細は既定値で読み込み、警告を返す', () => {
    const saved = JSON.parse(JSON.stringify(toSavedFinancePlan(domain)));
    saved.existingLoans[0].category = 'UNKNOWN';
    saved.newLoans[0].method = 'WEIRD';
    const parsed = parseSavedFinancePlan(saved);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.value.existingLoans[0].category).toBe('OTHER');
    expect(parsed.value.newLoans[0].method).toBe('EQUAL_PRINCIPAL');
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('STAGE1・STAGE4データの非破壊', () => {
  it('保存・元データの読み取りは入力データを変更しない', () => {
    deepFreeze(domain);
    deepFreeze(source);
    expect(() => toSavedFinancePlan(domain)).not.toThrow();
    expect(() => sourceHashOf(source)).not.toThrow();
  });
});

describe('会社の分離', () => {
  const meta = (companyId: string | null, over: Partial<CalcSnapshotMeta> = {}): CalcSnapshotMeta => ({
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId,
    baseYear: 2025,
    bsBaseYear: 2025,
    assumptionsHash: hashOf(toSavedFinancePlan(domain)),
    sourceHash: sourceHashOf(source),
    unconfirmed: { unapprovedReadyYen: 1_000_000, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
    computedAt: '2026-10-20T00:00:00.000Z',
    ...over,
  });

  it('異なる会社の保存データは復元せず、会社不明でも復元しない', () => {
    expect(canRestoreFor('company-A', 'company-B')).toBe(false);
    expect(canRestoreFor(null, 'company-A')).toBe(false);
    expect(canRestoreFor('company-A', null)).toBe(false);
    expect(canRestoreFor('company-A', 'company-A')).toBe(true);
  });

  it('別会社の計画は「最新試算」として表示せず、別会社と判定する', () => {
    const f = judgeFreshness(meta('company-A'), meta('company-B'));
    expect(f.kind).toBe('DIFFERENT_COMPANY');
    expect(freshnessLabel(f)).toContain('別の会社');
  });

  it('保存は会社IDを明示する経路を使い、残るリスクを表示する', () => {
    const availability = saveAvailability();
    expect(availability.enabled).toBe(true);
    expect(availability.residualRisks.some((r) => r.includes('RLS'))).toBe(true);
    expect(availability.residualRisks.some((r) => r.includes('Cookie'))).toBe(true);
  });

  it('保存データは会社IDを持ち、別の会社では読み込まない', () => {
    const meta: CalcSnapshotMeta = {
      calcVersion: FINANCE_PLAN_CALC_VERSION,
      companyId: 'company-A',
      baseYear: 2025,
      bsBaseYear: 2025,
      assumptionsHash: hashOf(toSavedFinancePlan(domain)),
      sourceHash: sourceHashOf(source),
      unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2026-10-20T00:00:00.000Z',
    };
    const stored = JSON.parse(
      JSON.stringify(buildStoredFinancePlan({ domain, companyId: 'company-A', meta, savedAt: '2026-10-20T00:00:00.000Z' })),
    );
    expect(readStoredFinancePlan(stored, 'company-B').kind).toBe('DIFFERENT_COMPANY');
    expect(readStoredFinancePlan(stored, null).kind).toBe('DIFFERENT_COMPANY');
    const ok = readStoredFinancePlan(stored, 'company-A');
    expect(ok.kind).toBe('OK');
    if (ok.kind === 'OK') {
      expect(ok.domain.assumptions).toEqual(assumptions);
      expect(ok.meta.assumptionsHash).toBe(meta.assumptionsHash);
    }
    expect(readStoredFinancePlan(undefined, 'company-A').kind).toBe('NONE');
  });

  it('保存データが壊れていれば読み込まず、理由を返す', () => {
    const r = readStoredFinancePlan({ companyId: 'company-A', formatVersion: 1, unit: 'MILLION_YEN' }, 'company-A');
    expect(r.kind).toBe('INVALID');
  });
});

describe('保存した前提からのCF再計算', () => {
  const cfInput = (debt?: ReturnType<typeof buildDebtSchedule>): CashFlowInput => ({
    financePL: pl,
    financeBS: bs,
    investment: {
      yearlyByCategory: investment.yearlyByCategory,
      unclassifiedYen: 0,
      unscheduledYen: 0,
      candidateYen: 0,
      basisPendingYen: 0,
    },
    assumptions,
    debt,
    fiscalYearEndSet: true,
  });
  const debtFrom = (d: FinancePlanDomain) =>
    buildDebtSchedule({
      forecastYears: [2026, 2027, 2028],
      existingLoans: d.existingLoans,
      newLoans: d.newLoans,
      stage1InterestBearingDebtYen: 100_000_000,
      dividendsYen: d.dividendsYen,
      fiscalYearEndSet: true,
    });

  it('保存・復元した前提から、直接の入力と同じ結果を再計算できる', () => {
    const parsed = parseSavedFinancePlan(JSON.parse(JSON.stringify(toSavedFinancePlan(domain))));
    if (!parsed.ok) throw new Error('parse failed');
    const direct = buildCashFlowPlan(cfInput(debtFrom(domain)), 2026);
    const restored = buildCashFlowPlan(cfInput(debtFrom(parsed.value)), 2026);
    expect(restored.years).toEqual(direct.years);
  });

  it('同じ前提・同じ元データからは同じ計算結果になる（再現性）', () => {
    const a = buildCashFlowPlan(cfInput(debtFrom(domain)), 2026);
    const b = buildCashFlowPlan(cfInput(debtFrom(domain)), 2026);
    expect(b).toEqual(a);
  });
});

describe('データ変更後の再計算と古い計画の区別', () => {
  const current = (src: SourceSummary = source, a: FinancePlanDomain = domain): CalcSnapshotMeta => ({
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: 'company-A',
    baseYear: 2025,
    bsBaseYear: 2025,
    assumptionsHash: hashOf(toSavedFinancePlan(a)),
    sourceHash: sourceHashOf(src),
    unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
    computedAt: '2026-10-20T00:00:00.000Z',
  });
  const savedMeta = current();

  it('STAGE1の財務実績が変わると、過去の計算として判定する', () => {
    const changedPL = source.financePL.map((r) => (r.year === 2025 ? { ...r, revenue: 1_100_000_000 } : r));
    const f = judgeFreshness(savedMeta, current({ ...source, financePL: changedPL }));
    expect(f.kind).toBe('STALE');
    if (f.kind === 'STALE') expect(f.reasons.some((r) => r.includes('STAGE1'))).toBe(true);
  });

  it('STAGE4の投資計画が変わると、過去の計算として判定する', () => {
    const f = judgeFreshness(savedMeta, current({ ...source, investment: { ...investment, unclassifiedYen: 5 } }));
    expect(f.kind).toBe('STALE');
  });

  it('入力前提が変わると、過去の計算として判定する', () => {
    const f = judgeFreshness(savedMeta, current(source, { ...domain, assumptions: { ...assumptions, taxRate: 0.25 } }));
    expect(f.kind).toBe('STALE');
    expect(freshnessLabel(f)).toContain('過去の計算');
  });

  it('元データと前提が変わらなければ最新試算として判定する', () => {
    const f = judgeFreshness(savedMeta, current());
    expect(f.kind).toBe('CURRENT');
  });

  it('保存済みの計画がなければ、現在の試算のみとして表示する', () => {
    expect(judgeFreshness(null, current()).kind).toBe('NO_SAVED');
  });

  it('計算ロジックのバージョンが変わると過去の計算として判定する', () => {
    const f = judgeFreshness({ ...savedMeta, calcVersion: 'phase3' }, current());
    expect(f.kind).toBe('STALE');
  });
});

describe('未承認・未確定の計画の扱い', () => {
  it('最新試算でも未承認・未確定の投資があれば、その旨を表示する', () => {
    const meta: CalcSnapshotMeta = {
      calcVersion: FINANCE_PLAN_CALC_VERSION,
      companyId: 'company-A',
      baseYear: 2025,
      bsBaseYear: 2025,
      assumptionsHash: hashOf(toSavedFinancePlan(domain)),
      sourceHash: sourceHashOf(source),
      unconfirmed: { unapprovedReadyYen: 1_000_000, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2026-10-20T00:00:00.000Z',
    };
    const f = judgeFreshness(meta, meta);
    expect(f).toEqual({ kind: 'CURRENT', hasUnconfirmed: true });
    expect(freshnessLabel(f)).toContain('未確定・未承認');
  });
});

describe('保存失敗時のエラー表示', () => {
  it('再保存が必要な競合・権限不足・その他の失敗をそれぞれ説明する', () => {
    expect(describeSaveError({ status: 409 })).toContain('再読み込み');
    expect(describeSaveError({ status: 403 })).toContain('権限');
    expect(describeSaveError({ status: 500 })).toContain('入力内容は画面に残っています');
    expect(describeSaveError(null)).toContain('入力内容は画面に残っています');
  });
});

describe('既存STAGE6計算への非干渉', () => {
  it('保存前提の計算モジュールは既存のSTAGE6計算・ストア・保存処理を読み込まない', () => {
    for (const file of ['financePlanSnapshot.ts']) {
      const source = readFileSync(path.join(__dirname, file), 'utf8');
      const imports = source.split('\n').filter((l) => l.startsWith('import'));
      for (const line of imports) {
        expect(line).not.toMatch(/compute|baseline|useStage6Data|simulationBridge|financeSimulation|strategyStore|supabase/);
      }
    }
  });
});

describe('全体保存との連携（作業コピー・保存済み版の扱い）', () => {
  const makeSnapshot = (taxRate: number) => {
    const d = { ...domain, assumptions: { ...assumptions, taxRate } };
    return buildStoredFinancePlan({
      domain: d,
      companyId: 'company-A',
      meta: {
        calcVersion: FINANCE_PLAN_CALC_VERSION,
        companyId: 'company-A',
        baseYear: 2025,
        bsBaseYear: 2025,
        assumptionsHash: hashOf(toSavedFinancePlan(d)),
        sourceHash: sourceHashOf(source),
        unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
        computedAt: '2026-10-20T00:00:00.000Z',
      },
      savedAt: '2026-10-20T00:00:00.000Z',
    });
  };

  it('作業コピーへの反映は、既存の財務データ（financeBSなど）を残す', () => {
    const csv = { financeBS: [{ year: 2025, cash: 1 }], segmentPL: { x: [] } };
    const next = applyWorkingSnapshot(csv, makeSnapshot(0.2));
    expect(next.financeBS).toEqual([{ year: 2025, cash: 1 }]);
    expect(next.segmentPL).toEqual({ x: [] });
    expect(next.financePlanAssumptions).toBeDefined();
    expect(csv).not.toHaveProperty('financePlanAssumptions');
  });

  it('全体保存は、編集後の最新の作業コピーを保存対象にする（古い保存版で上書きしない）', () => {
    const dbCsv = { financeBS: [], financePlanAssumptions: makeSnapshot(0.3) };
    const workingCsv = applyWorkingSnapshot(dbCsv, makeSnapshot(0.25));
    const toSave = pickFinancePlanForSave(workingCsv, dbCsv) as { cashFlow: { taxRate: number } };
    expect(toSave.cashFlow.taxRate).toBe(0.25);
  });

  it('作業コピーがない場合は、既存の保存版を引き継ぐ', () => {
    const dbCsv = { financeBS: [], financePlanAssumptions: makeSnapshot(0.3) };
    expect(pickFinancePlanForSave({ financeBS: [] }, dbCsv)).toBe(dbCsv.financePlanAssumptions);
    expect(pickFinancePlanForSave(undefined, dbCsv)).toBe(dbCsv.financePlanAssumptions);
  });

  it('未保存の判定：保存版がなく入力もなければ未保存ではない', () => {
    expect(financePlanUnsaved({ currentHash: 'a', savedHash: undefined, workingHash: undefined, hasInput: false })).toBe(false);
  });

  it('未保存の判定：保存版がなく入力があれば未保存', () => {
    expect(financePlanUnsaved({ currentHash: 'a', savedHash: undefined, workingHash: undefined, hasInput: true })).toBe(true);
  });

  it('未保存の判定：読み込み直後（作業コピー＝保存版）は未保存ではない', () => {
    expect(financePlanUnsaved({ currentHash: 'a', savedHash: undefined, workingHash: 'a', hasInput: true })).toBe(false);
  });

  it('未保存の判定：編集後（保存版と異なる）は未保存。画面を移動して戻っても保持される', () => {
    expect(financePlanUnsaved({ currentHash: 'b', savedHash: 'a', workingHash: 'b', hasInput: true })).toBe(true);
  });

  it('未保存の判定：保存成功後（保存版＝現在）は未保存ではない', () => {
    expect(financePlanUnsaved({ currentHash: 'b', savedHash: 'b', workingHash: 'b', hasInput: true })).toBe(false);
  });

  it('作業コピーのハッシュを読み出せる', () => {
    expect(workingHashOf({ financePlanAssumptions: makeSnapshot(0.2) })).toBe(makeSnapshot(0.2).meta.assumptionsHash);
    expect(workingHashOf({})).toBeUndefined();
  });
});
