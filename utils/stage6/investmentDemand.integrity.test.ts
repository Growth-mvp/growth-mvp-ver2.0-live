/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  applyDuplicateDecision,
  applySpendPatch,
  buildInvestmentDemandSummary,
  buildInvestmentItems,
  type InvestmentItem,
} from './investmentDemand';

const IMPACT = 'IMPACT_INVESTMENT:impact';
const KEEP = 'SKILL_PLAN:k';

function baseDepartments(): any[] {
  return [
    {
      name: '営業部',
      projects: [
        {
          id: 'p1',
          title: 'P',
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

function markSame(depts: any[]): any[] {
  return applyDuplicateDecision(depts, 0, 0, IMPACT, 'SAME_DUPLICATE', KEEP);
}

function itemOf(depts: any[], itemId: string): InvestmentItem {
  const found = buildInvestmentItems(depts).find((i) => i.itemId === itemId);
  if (!found) throw new Error(`missing ${itemId}`);
  return found;
}

function readyTotal(depts: any[]): number {
  return buildInvestmentDemandSummary(depts, '3').readyYen;
}

describe('重複判断の整合性（判断後の変更・削除）', () => {
  it('前提：同一支出として指定すると、集計対象だけが計上される', () => {
    const depts = markSame(baseDepartments());
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
    expect(itemOf(depts, KEEP).duplicateStatus).toBe('SAME_KEEP');
    expect(readyTotal(depts)).toBe(1_000_000);
  });

  it('参照先明細が削除されると、判断は無効になり除外のまま要確認になる', () => {
    const depts = markSame(baseDepartments());
    depts[0].projects[0].skillPlans = [];
    const impact = itemOf(depts, IMPACT);
    expect(impact.duplicateStatus).toBe('CANDIDATE');
    expect(impact.duplicateNote).toContain('見つからない');
    expect(readyTotal(depts)).toBe(0);
  });

  it('参照先明細の金額が変わると、両方の判断が無効になる', () => {
    const depts = markSame(baseDepartments());
    depts[0].projects[0].skillPlans[0].cost = 1_500_000;
    expect(itemOf(depts, KEEP).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(readyTotal(depts)).toBe(0);
  });

  it('参照先明細の支出時期が変わると、両方の判断が無効になる', () => {
    const depts = markSame(baseDepartments());
    const keep = itemOf(depts, KEEP);
    const changed = applySpendPatch(depts, keep.ref, { paymentYm: '2026-06' });
    expect(itemOf(changed, KEEP).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(changed, IMPACT).duplicateStatus).toBe('CANDIDATE');
  });

  it('除外側の明細の金額が変わると、その明細だけ要確認になり、集計対象は残る', () => {
    const depts = markSame(baseDepartments());
    depts[0].projects[0].impactInvestmentMJPY = 25;
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(depts, KEEP).duplicateStatus).toBe('SAME_KEEP');
    expect(readyTotal(depts)).toBe(1_000_000);
  });

  it('除外側の明細の支出時期が変わると、判断は無効になる', () => {
    const depts = markSame(baseDepartments());
    const impact = itemOf(depts, IMPACT);
    const changed = applySpendPatch(depts, impact.ref, { paymentYm: '2026-06' });
    expect(itemOf(changed, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(readyTotal(changed)).toBe(1_000_000);
  });

  it('プロジェクト名が変わっても、安定したIDがあれば判断は維持される', () => {
    const depts = markSame(baseDepartments());
    depts[0].projects[0].title = 'P2';
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
    expect(itemOf(depts, KEEP).duplicateStatus).toBe('SAME_KEEP');
  });

  it('IDを持たないプロジェクトでは、名称が変わると両方の判断が無効になる', () => {
    const depts = markSame(baseDepartments());
    delete depts[0].projects[0].id;
    const decided = markSame(depts);
    decided[0].projects[0].title = 'P2';
    expect(itemOf(decided, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(decided, KEEP).duplicateStatus).toBe('CANDIDATE');
  });

  it('プロジェクトIDが変わると、両方の判断が無効になる', () => {
    const depts = markSame(baseDepartments());
    depts[0].projects[0].id = 'p9';
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(depts, KEEP).duplicateStatus).toBe('CANDIDATE');
  });

  it('金額・支出時期と無関係な項目（支出区分）の変更では判断は無効にならない', () => {
    const depts = markSame(baseDepartments());
    const keep = itemOf(depts, KEEP);
    const changed = applySpendPatch(depts, keep.ref, { category: 'OPEX' });
    expect(itemOf(changed, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
    expect(readyTotal(changed)).toBe(1_000_000);
  });

  it('同一支出の判断を解除すると、除外していた明細は要確認に戻る（二重計上しない）', () => {
    const depts = applyDuplicateDecision(markSame(baseDepartments()), 0, 0, IMPACT, null);
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(depts, KEEP).duplicateStatus).toBe('SAME_KEEP');
    expect(readyTotal(depts)).toBe(1_000_000);
  });

  it('集計対象側の判断を解除すると、除外側は集計されず要確認になる', () => {
    const depts = applyDuplicateDecision(markSame(baseDepartments()), 0, 0, KEEP, null);
    const impact = itemOf(depts, IMPACT);
    expect(impact.duplicateStatus).toBe('CANDIDATE');
    expect(impact.counted).toBe(false);
    expect(itemOf(depts, KEEP).counted).toBe(true);
  });

  it('金額変更後に判断し直すと、新しい金額で再度集計される', () => {
    let depts = markSame(baseDepartments());
    depts[0].projects[0].skillPlans[0].cost = 1_500_000;
    depts = applyDuplicateDecision(depts, 0, 0, KEEP, 'SAME_KEEP');
    depts = markSame(depts);
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('SAME_DUPLICATE');
    expect(readyTotal(depts)).toBe(1_500_000);
  });

  it('指紋のない古い形式の判断は無効として扱い、要確認に残す', () => {
    const depts = applySpendPatch(baseDepartments(), itemOf(baseDepartments(), IMPACT).ref, {
      duplicateReview: { decision: 'DIFFERENT' },
    });
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(depts, IMPACT).counted).toBe(false);
  });

  it('同一支出の集計対象として存在しない明細IDを指定しても判断は保存されない', () => {
    const depts = applyDuplicateDecision(baseDepartments(), 0, 0, IMPACT, 'SAME_DUPLICATE', 'SKILL_PLAN:none');
    expect(itemOf(depts, IMPACT).duplicateStatus).toBe('CANDIDATE');
    expect(itemOf(depts, IMPACT).counted).toBe(false);
    expect(readyTotal(depts)).toBe(1_000_000);
  });
});
