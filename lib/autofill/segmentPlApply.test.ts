import { planFilingApply, type ApplicableCandidate, type CurrentFilingProfile } from './filingCandidates';

const CURRENT: CurrentFilingProfile = {
  companyName: '株式会社サンプル',
  ticker: '',
  fiscalYearEnd: '',
  isListed: undefined,
  location: '',
  employees: '',
  businessContent: '',
  industry: '',
};

const src = { source: 'DOCUMENT' as const, fileName: 'sample.pdf', periodEnd: null, fetchedAt: '2026-11-26T00:00:00.000Z' };

function candidateWithSegments(): ApplicableCandidate {
  return {
    filer: { name: '株式会社サンプル', secCode: null, edinetCode: null },
    fiscalYear: 2026,
    profile: { fields: {}, issues: [] },
    profileExtra: {},
    finance: [],
    segments: {
      periodEnd: '2026',
      issues: [],
      items: [
        {
          name: '宅配',
          memberCode: '宅配',
          sales: 28_000_000,
          operatingIncome: 2_300_000,
          byYear: [
            { year: 2025, sales: 21_000_000, operatingIncome: 1_500_000 },
            { year: 2026, sales: 28_000_000, operatingIncome: 2_300_000 },
          ],
        },
      ],
    },
    issues: [],
  };
}

function plan(over: Partial<Parameters<typeof planFilingApply>[0]>) {
  return planFilingApply({
    current: CURRENT,
    currentFinance: [],
    candidate: candidateWithSegments(),
    selectedProfile: [],
    overwriteProfile: [],
    selectedYears: [],
    overwriteYears: [],
    ...over,
  });
}

describe('事業別PLの反映：登録中の年度は、上書きを選んだ時だけ変える', () => {
  it('登録中の事業の空いている年度を、円のまま埋める（丸めない）', () => {
    const p = plan({ segmentPlNames: ['宅配'], currentSegmentPL: { 宅配: [{ year: 2025, revenue: 21_000_000, operatingIncome: 1_500_000, grossProfit: 3 }] } });
    expect(p.segmentPlPatch).toEqual({
      宅配: [
        { year: 2025, revenue: 21_000_000, operatingIncome: 1_500_000, grossProfit: 3 },
        { year: 2026, revenue: 28_000_000, operatingIncome: 2_300_000 },
      ],
    });
  });

  it('登録中の値と違う年度は、上書きを選んだ年度だけ変える', () => {
    const current = { 宅配: [{ year: 2025, revenue: 20_000_000 }, { year: 2026, revenue: 28_000_000, operatingIncome: 2_000_000 }] };
    const kept = plan({ segmentPlNames: ['宅配'], currentSegmentPL: current });
    expect(kept.segmentPlPatch).toEqual({ 宅配: [{ year: 2025, revenue: 20_000_000, operatingIncome: 1_500_000 }, { year: 2026, revenue: 28_000_000, operatingIncome: 2_000_000 }] });

    const overwritten = plan({ segmentPlNames: ['宅配'], currentSegmentPL: current, overwriteYears: [2025] });
    expect(overwritten.segmentPlPatch?.宅配.find((r) => r.year === 2025)).toEqual({ year: 2025, revenue: 21_000_000, operatingIncome: 1_500_000 });
    expect(overwritten.segmentPlPatch?.宅配.find((r) => r.year === 2026)).toEqual({ year: 2026, revenue: 28_000_000, operatingIncome: 2_000_000 });
  });

  it('登録中の事業名と一致しない事業は、事業別PLに書かない', () => {
    expect(plan({ segmentPlNames: [], currentSegmentPL: {} }).segmentPlPatch).toBeNull();
  });

  it('すでに同じ値なら、書き込む項目はない', () => {
    const same = { 宅配: [{ year: 2025, revenue: 21_000_000, operatingIncome: 1_500_000 }, { year: 2026, revenue: 28_000_000, operatingIncome: 2_300_000 }] };
    expect(plan({ segmentPlNames: ['宅配'], currentSegmentPL: same }).segmentPlPatch).toBeNull();
  });

  it('事業の売上・利益を百万円へ換算するときも、丸めずに小数で持つ', () => {
    const p = plan({ selectedSegments: true, currentSegmentCount: 0, segmentPlNames: [] });
    expect(p.segmentsPatch?.[0]).toMatchObject({ name: '宅配', revenueMillion: 28, profitMillion: 2.3 });
  });
});

describe('現預金・有利子負債の反映', () => {
  it('貸借対照表の行に、登録中の値と同じ、または空いている項目として扱う', () => {
    const candidate: ApplicableCandidate = {
      ...candidateWithSegments(),
      segments: null,
      finance: [{ year: 2026, cash: { value: 12_000_000, source: src, fiscalYear: 2026, consolidation: 'UNKNOWN' }, interestBearingDebt: { value: 23_000_000, source: src, fiscalYear: 2026, consolidation: 'UNKNOWN' } }],
    };
    const p = plan({ candidate, selectedYears: [2026], currentFinance: [{ year: 2026, cash: 12_000_000, interestBearingDebt: null }] });
    expect(p.financeApplied).toEqual([{ year: 2026, keys: ['interestBearingDebt'] }]);
    expect(p.financeRows.find((r) => r.year === 2026)).toMatchObject({ cash: 12_000_000, interestBearingDebt: 23_000_000 });
  });
});
