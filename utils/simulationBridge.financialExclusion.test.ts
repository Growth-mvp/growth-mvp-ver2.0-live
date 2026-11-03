import { buildBridgeDeltas, getApplyMonths, krFinancialExclusionReason, listFinancialExclusions, type BridgeKR } from './simulationBridge';

const sum = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);

const kr = (o: Partial<BridgeKR> & Pick<BridgeKR, 'id' | 'kind' | 'label' | 'target'>): BridgeKR =>
  ({ unit: 'JPY', scope: 'company', baseKey: 'revenue', due: '2027-12', ...o } as BridgeKR);

const input = (krs: BridgeKR[]) => ({
  startYm: '2026-01',
  endYm: '2027-12',
  krs,
  base: {},
});

const EXCLUDED = ['INVEST', 'ACQ', 'SYNERGY', 'REVENUE', 'ARPU', 'CHURN', 'COST_FIXED', 'COST_VARIABLE', 'PERSONNEL', 'SUCCESS_RATE'] as const;

describe('財務換算の根拠が未設定のKRは、売上・費用・投資へ自動加算しない（P1a・P1b・P1.5）', () => {
  it.each(EXCLUDED)('%s は財務換算の対象外で、理由を持つ', (kind) => {
    expect(krFinancialExclusionReason(kind)).toEqual(expect.any(String));
  });

  it('活動指標（ACTIVITY）は、明示的な経路がない限り財務換算しない', () => {
    expect(krFinancialExclusionReason('ACTIVITY')).toBeNull();
  });

  it('対象外のKRは、理由つきで一覧にできる', () => {
    const list = listFinancialExclusions([
      kr({ id: 'a', kind: 'ACQ', label: '新規商談数', target: 120, unit: '件' }),
      kr({ id: 'b', kind: 'REVENUE', label: '新規受注', target: 40_000_000 }),
      kr({ id: 'c', kind: 'INVEST', label: '投資計画', target: 18_000_000 }),
    ]);
    expect(list.map((x) => x.label)).toEqual(['新規商談数', '新規受注', '投資計画']);
    expect(list.every((x) => x.reason.length > 0)).toBe(true);
  });

  it('金額型・率型のKRは、売上・費用・投資のどのデルタにも入らない', () => {
    const deltas = buildBridgeDeltas(
      input([
        kr({ id: 'a', kind: 'ACQ', label: '新規商談数', target: 120, unit: '件' }),
        kr({ id: 'b', kind: 'ACQ', label: '保守契約の継続率', target: 95, unit: '%' }),
        kr({ id: 'c', kind: 'INVEST', label: '投資計画', target: 18_000_000 }),
        kr({ id: 'd', kind: 'SYNERGY', label: '部門間連携', target: 5, unit: '%' }),
        kr({ id: 'e', kind: 'REVENUE', label: '新規受注', target: 40_000_000 }),
        kr({ id: 'f', kind: 'ARPU', label: '単価改善', target: 100_000 }),
        kr({ id: 'g', kind: 'CHURN', label: '継続率改善', target: 5, unit: '%' }),
        kr({ id: 'h', kind: 'COST_FIXED', label: '固定費', target: 1_000_000 }),
        kr({ id: 'i', kind: 'COST_VARIABLE', label: '変動費率', target: -5, unit: '%' }),
        kr({ id: 'j', kind: 'PERSONNEL', label: '人員計画', target: 1_000_000 }),
        kr({ id: 'k', kind: 'SUCCESS_RATE', label: '成約率', target: 80, unit: '%' }),
      ]),
    );
    expect(sum(deltas.acq)).toBe(0);
    expect(sum(deltas.invest)).toBe(0);
    expect(sum(deltas.synergy)).toBe(0);
    expect(sum(deltas.revenue)).toBe(0);
    expect(sum(deltas.arpu)).toBe(0);
    expect(sum(deltas.churn)).toBe(0);
    expect(sum(deltas.fixed_cost)).toBe(0);
    expect(sum(deltas.variable_cost)).toBe(0);
    expect(sum(deltas.cogsRate)).toBe(0);
    expect(sum(deltas.personnel_cost)).toBe(0);
    expect(sum(deltas.success_rate)).toBe(0);
  });
});

describe('実績年への効果加算の防止（P1-1 の回帰防止）', () => {
  it('効果の開始月は、実績年の翌年1月より前にならない', () => {
    const krWide = kr({ id: 'w', kind: 'REVENUE', label: '期限なし', target: 1 });
    const months = getApplyMonths('2025-01', '2027-12', krWide, '2026-01');
    expect(months[0]).toBe('2026-01');
    expect(months.some((m) => m.startsWith('2025'))).toBe(false);
  });

  it('KRの開始月が実績年の中にあっても、効果は翌年1月から', () => {
    const krEarly = kr({ id: 'w2', kind: 'REVENUE', label: '早期開始', target: 1, startYm: '2025-06' as any });
    expect(getApplyMonths('2025-01', '2027-12', krEarly, '2026-01')[0]).toBe('2026-01');
  });
});
