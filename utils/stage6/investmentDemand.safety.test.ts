/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  applyDuplicateDecision,
  applySpendPatch,
  buildInvestmentDemandSummary,
  buildInvestmentItems,
  fingerprintMatches,
  isPlanApproved,
  type InvestmentItem,
} from './investmentDemand';

const IMPACT = 'IMPACT_INVESTMENT:impact';
const KEEP = 'SKILL_PLAN:k';

function depts(overrides: Partial<{ planStatus: string; projectId: string; title: string }> = {}): any[] {
  return [
    {
      name: '営業部',
      projects: [
        {
          id: overrides.projectId ?? 'p1',
          title: overrides.title ?? 'P',
          planStatus: overrides.planStatus ?? 'draft',
          skillPlans: [
            {
              id: 'k',
              skillName: 'K',
              cost: 1_000_000,
              spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-04' },
            },
          ],
          impactInvestmentMJPY: 20,
          impactInvestmentSpend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-05' },
        },
      ],
    },
  ];
}

function sameDecided(d: any[]): any[] {
  return applyDuplicateDecision(d, 0, 0, IMPACT, 'SAME_DUPLICATE', KEEP);
}

function itemOf(d: any[], itemId: string): InvestmentItem {
  const found = buildInvestmentItems(d).find((i) => i.itemId === itemId);
  if (!found) throw new Error(`missing ${itemId}`);
  return found;
}

describe('承認済みプロジェクトの重複判断は読み取り専用', () => {
  it('承認済みでは判断を保存せず、データを変えない', () => {
    const approved = depts({ planStatus: 'approved' });
    const result = applyDuplicateDecision(approved, 0, 0, IMPACT, 'SAME_DUPLICATE', KEEP);
    expect(result).toBe(approved);
    expect(itemOf(result, IMPACT).duplicateStatus).toBe('CANDIDATE');
  });

  it('承認済みでは判断の解除もできない', () => {
    const decided = sameDecided(depts({ planStatus: 'approved' }));
    const approvedWithReview = depts({ planStatus: 'approved' });
    approvedWithReview[0].projects[0].impactInvestmentSpend = {
      ...approvedWithReview[0].projects[0].impactInvestmentSpend,
      duplicateReview: decided[0].projects[0].impactInvestmentSpend.duplicateReview,
    };
    const result = applyDuplicateDecision(approvedWithReview, 0, 0, IMPACT, null);
    expect(result).toBe(approvedWithReview);
  });

  it('未承認（draft・review・未設定）では判断を編集できる', () => {
    for (const status of ['draft', 'review', undefined]) {
      const d = depts({ planStatus: status });
      const result = applyDuplicateDecision(d, 0, 0, IMPACT, 'SAME_DUPLICATE', KEEP);
      expect(itemOf(result, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
    }
  });

  it('承認判定は planStatus === approved のみを承認とみなす', () => {
    expect(isPlanApproved({ planStatus: 'approved' })).toBe(true);
    expect(isPlanApproved({ planStatus: 'review' })).toBe(false);
    expect(isPlanApproved({ planStatus: 'draft' })).toBe(false);
    expect(isPlanApproved({})).toBe(false);
    expect(isPlanApproved(undefined)).toBe(false);
  });

  it('同じ名前の別プロジェクトが未承認なら、承認済みの側は変わらず未承認の側だけ判断できる', () => {
    const d = [
      {
        name: '営業部',
        projects: [
          { id: 'a', title: 'P', planStatus: 'approved', impactInvestmentMJPY: 5, impactInvestmentSpend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-05' }, skillPlans: [{ id: 's', cost: 5_000_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-05' } }] },
          { id: 'b', title: 'P', planStatus: 'draft', impactInvestmentMJPY: 5, impactInvestmentSpend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-05' }, skillPlans: [{ id: 's', cost: 5_000_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-05' } }] },
        ],
      },
    ];
    const result = applyDuplicateDecision(d as any, 0, 1, 'IMPACT_INVESTMENT:impact', 'DIFFERENT');
    expect(result[0].projects[0]).toBe(d[0].projects[0]);
    expect(result[0].projects[1]?.impactInvestmentSpend?.duplicateReview?.decision).toBe('DIFFERENT');
  });
});

describe('プロジェクト名の変更では判断を維持し、IDの変更では再確認する', () => {
  it('安定したIDがあれば、プロジェクト名を変えても判断は維持される', () => {
    const decided = sameDecided(depts());
    const renamed = decided.map((dept) => ({
      ...dept,
      projects: dept.projects.map((p: any) => ({ ...p, title: 'P改名後' })),
    }));
    expect(itemOf(renamed, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
    expect(itemOf(renamed, KEEP).duplicateStatus).toBe('SAME_KEEP');
    expect(buildInvestmentDemandSummary(renamed, '3').readyYen).toBe(1_000_000);
  });

  it('部門名を変えても、プロジェクトIDが同じなら判断は維持される', () => {
    const decided = sameDecided(depts());
    const renamedDept = decided.map((dept) => ({ ...dept, name: '営業本部' }));
    expect(itemOf(renamedDept, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
  });

  it('プロジェクトIDが変わると再確認が必要になる', () => {
    const decided = sameDecided(depts());
    decided[0].projects[0].id = 'p9';
    expect(itemOf(decided, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(decided, KEEP).duplicateStatus).toBe('CANDIDATE');
  });

  it('金額・支出時期の変更では、名称に関係なく再確認が必要になる', () => {
    const decided = sameDecided(depts());
    decided[0].projects[0].impactInvestmentMJPY = 21;
    expect(itemOf(decided, IMPACT).duplicateStatus).toBe('CANDIDATE');
    const timed = sameDecided(depts());
    const impact = itemOf(timed, IMPACT);
    const moved = applySpendPatch(timed, impact.ref, { paymentYm: '2026-07' });
    expect(itemOf(moved, IMPACT).duplicateStatus).toBe('CANDIDATE');
  });

  it('インデックス由来の仮ID（proj_0_0）は安定IDとして扱わず、名称で照合する', () => {
    const d = depts({ projectId: 'proj_0_0' });
    const decided = sameDecided(d);
    const renamed = decided.map((dept) => ({
      ...dept,
      projects: dept.projects.map((p: any) => ({ ...p, title: '改名' })),
    }));
    expect(itemOf(renamed, IMPACT).duplicateStatus).toBe('CANDIDATE');
  });
});

describe('既存の保存データとの互換性（Phase 1.5 の指紋形式）', () => {
  // Phase 1.5 で保存された指紋: "<部門>::<プロジェクト>::<ID>|<金額>|<継続性>|<基準>|<支出月>|<開始月>|<終了月>"
  function legacyFingerprintForImpact(deptName: string, title: string, id: string): string {
    return [`${deptName}::${title}::${id}`, '20000000', 'ONE_TIME', 'TOTAL', '2026-05', '', ''].join('|');
  }

  it('旧形式の指紋は、同じ明細・同じIDであれば有効のまま扱う', () => {
    const d = depts();
    d[0].projects[0].impactInvestmentSpend = {
      ...d[0].projects[0].impactInvestmentSpend,
      duplicateReview: { decision: 'DIFFERENT', fingerprint: legacyFingerprintForImpact('営業部', 'P', 'p1') },
    };
    expect(itemOf(d, IMPACT).duplicateStatus).toBe('DIFFERENT');
    expect(itemOf(d, IMPACT).counted).toBe(true);
  });

  it('旧形式の指紋でも、プロジェクト名が変わったときはIDで照合して有効のまま扱う', () => {
    const d = depts({ title: 'P改名後' });
    d[0].projects[0].impactInvestmentSpend = {
      ...d[0].projects[0].impactInvestmentSpend,
      duplicateReview: { decision: 'DIFFERENT', fingerprint: legacyFingerprintForImpact('営業部', 'P', 'p1') },
    };
    expect(itemOf(d, IMPACT).duplicateStatus).toBe('DIFFERENT');
  });

  it('旧形式の指紋でも、金額が変わっていれば再確認が必要になる', () => {
    const d = depts();
    d[0].projects[0].impactInvestmentMJPY = 25;
    d[0].projects[0].impactInvestmentSpend = {
      ...d[0].projects[0].impactInvestmentSpend,
      duplicateReview: { decision: 'DIFFERENT', fingerprint: legacyFingerprintForImpact('営業部', 'P', 'p1') },
    };
    expect(itemOf(d, IMPACT).duplicateStatus).toBe('CANDIDATE');
  });

  it('旧形式の指紋はIDが変わると一致しない', () => {
    const legacy = legacyFingerprintForImpact('営業部', 'P', 'p1');
    const current = itemOf(depts({ projectId: 'p9' }), IMPACT).fingerprint;
    expect(fingerprintMatches(legacy, current)).toBe(false);
  });

  it('保存された指紋が無い判断は無効として扱う', () => {
    expect(fingerprintMatches(undefined, itemOf(depts(), IMPACT).fingerprint)).toBe(false);
    expect(fingerprintMatches('', itemOf(depts(), IMPACT).fingerprint)).toBe(false);
  });

  it('新形式の指紋は、保存・読み直し（JSON往復）後も一致する', () => {
    const decided = sameDecided(depts());
    const roundTripped = JSON.parse(JSON.stringify(decided));
    expect(itemOf(roundTripped, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
  });
});

describe('部門・プロジェクトの分離', () => {
  it('判断は指定した部門・プロジェクトにだけ作用する', () => {
    const d = [
      { name: '部門1', projects: [{ id: 'same', title: 'P', skillPlans: [{ id: 'k', cost: 1_000 }] }] },
      { name: '部門2', projects: [{ id: 'same', title: 'P', skillPlans: [{ id: 'k', cost: 2_000 }] }] },
    ];
    const result = applyDuplicateDecision(d as any, 1, 0, 'SKILL_PLAN:k', 'DIFFERENT');
    expect(result[0]).toBe(d[0]);
    expect(result[1].projects[0]?.skillPlans?.[0]?.spend?.duplicateReview?.decision).toBe('DIFFERENT');
    expect(result[0].projects[0]?.skillPlans?.[0]?.spend).toBeUndefined();
  });

  it('存在しない部門・プロジェクトの指定では何も変わらない', () => {
    const d = depts();
    expect(applyDuplicateDecision(d, 5, 0, IMPACT, 'DIFFERENT')).toBe(d);
    expect(applyDuplicateDecision(d, 0, 9, IMPACT, 'DIFFERENT')).toBe(d);
  });

  it('集計は部門ごとに分かれ、確認済みの金額が混ざらない', () => {
    const d = [
      { name: '部門1', projects: [{ id: 'a', title: 'P', skillPlans: [{ id: 'x', cost: 1_000_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-04' } }] }] },
      { name: '部門2', projects: [{ id: 'b', title: 'P', skillPlans: [{ id: 'x', cost: 3_000_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-04' } }] }] },
    ];
    const summary = buildInvestmentDemandSummary(d as any, '3');
    expect(summary.byDepartment).toEqual([
      { deptName: '部門1', amountYen: 1_000_000 },
      { deptName: '部門2', amountYen: 3_000_000 },
    ]);
  });
});
