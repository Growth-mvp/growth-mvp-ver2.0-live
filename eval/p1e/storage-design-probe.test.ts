/* STAGE4 保存方式の設計検証（モック・読み取り専用）。実 DB には接続しない。 */
import { buildDbRowFromState } from '@/utils/supabase/strategy';

describe('既存JSON列の流用（swot_suggestions）: 状態に無い値は保存で消える', () => {
  it('state に入っていないパック値は、保存行から消える（既存DB値を上書きする）', () => {
    const row: any = buildDbRowFromState({
      companyName: 'x',
      swotSuggestions: { opportunity: ['機会1'] },
    } as any);
    expect(row.swot_suggestions).toEqual({ opportunity: ['機会1'] });
    expect(row.swot_suggestions.stage4Pack).toBeUndefined();
  });

  it('同じ列にパックするには、保存のたびに state へ同じ値を入れ直す必要がある', () => {
    const row: any = buildDbRowFromState({
      companyName: 'x',
      swotSuggestions: { opportunity: ['機会1'] },
      midtermStrategy: { midtermConcept: 'c' },
    } as any);
    expect(row.swot_suggestions.midtermStrategy).toEqual({ midtermConcept: 'c' });
    expect(row.swot_suggestions.opportunity).toEqual(['機会1']);
  });
});

describe('departments 列の全置換: 再生成で項目が落ちると、保存で DB も落ちる', () => {
  const beforeRegen = [
    {
      id: 'dept-sales',
      name: '営業部',
      projects: [{ id: 'proj-1', title: '新規顧客開拓', planStatus: 'approved', approvedBy: 'u1', executionHumanInvestments: [{ id: 'h1', amount: 1000 }] }],
    },
  ];
  // 再生成（apply の置換経路）で作られる project は API の draft 由来で、既存の計画項目を持たない
  const afterRegen = [
    {
      id: 'dept-sales',
      name: '営業部',
      projects: [{ id: 'proj-1-r-xyz', title: '新規顧客開拓' }],
    },
  ];

  it('保存行は、state の departments をそのまま写す（承認・人的投資が行から消える）', () => {
    const row: any = buildDbRowFromState({ companyName: 'x', departments: afterRegen } as any);
    const p = row.departments[0].projects[0];
    expect(p.planStatus).toBeUndefined();
    expect(p.executionHumanInvestments).toBeUndefined();
    expect(p.id).toBe('proj-1-r-xyz');
  });

  it('再生成前の値を保持していれば、行に残る（保護が必要な理由）', () => {
    const row: any = buildDbRowFromState({ companyName: 'x', departments: beforeRegen } as any);
    expect(row.departments[0].projects[0].planStatus).toBe('approved');
    expect(row.departments[0].projects[0].executionHumanInvestments[0].amount).toBe(1000);
  });
});
