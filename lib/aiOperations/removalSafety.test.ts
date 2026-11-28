import { removalCheck } from './removalSafety';

// 既存の戦略がある企業。事業「製造事業」は部門・ポートフォリオに紐づき、「離脱」は目標とプロジェクトに紐づく。
// 事業「フィットネス」「新規顧客の獲得が鈍い」は、後から追加した未使用のデータ。
const STRATEGY = {
  businessSegments: [
    { id: 'seg-1', name: '製造事業' },
    { id: 'seg-2', name: 'フィットネス' },
  ],
  stage1Issues: [
    { title: '新規顧客の獲得が鈍い', description: '', linkedMetrics: [], scope: 'company' },
    { title: '離脱', description: '', linkedMetrics: [], scope: 'company' },
  ],
  segmentPL: {},
  segmentBS: {},
  departments: [{ name: '営業部', segmentName: '製造事業', mission: '', projects: [], finalized: false }],
  businessPortfolio: {
    unitType: 'business',
    periodLabel: 'FY2025',
    currency: 'JPY',
    threshold: { growthBaseline: 0, profitBaseline: 0 },
    units: [{ id: '製造事業', name: '製造事業', growthRate: 0, profitMargin: 0, revenueShare: 0 }],
  },
  companyTargets: [{ id: 't1', label: '売上を伸ばす', base: 0, linkedIssueIds: ['離脱'] }],
  projectIssueLinks: [{ projectId: 'p1', issueId: '離脱', strength: 2 }],
  story: [{ chapter: 1 }],
  midtermStrategy: { midtermConcept: '中計' },
} as const;

const fitness = { kind: 'segment.remove', id: 'seg-2', name: 'フィットネス' } as const;
const newCustomer = { kind: 'issue.remove', title: '新規顧客の獲得が鈍い' } as const;

describe('① 既存の戦略がある企業で、後から追加した未使用の事業・経営課題を削除できる', () => {
  it('戦略・ストーリー・ポートフォリオがあっても、紐づきがなければ削除の確認に進める', () => {
    expect(removalCheck(fitness, STRATEGY as never)).toEqual({ ok: true });
  });

  it('紐づきのない経営課題も削除できる', () => {
    expect(removalCheck(newCustomer, STRATEGY as never)).toEqual({ ok: true });
  });
});

describe('② 戦略や財務データに紐づいている事業・経営課題は保護され、理由を伝える', () => {
  it('部門に紐づく事業は、その理由を示して削除しない（自動生成のポートフォリオは理由にしない）', () => {
    const r = removalCheck({ kind: 'segment.remove', id: 'seg-1', name: '製造事業' }, STRATEGY as never);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toContain('部門「営業部」（この事業に紐づけ）');
    expect(r.ok ? '' : r.reason).not.toContain('ポートフォリオ');
  });

  it('自動生成と区別できない事業ポートフォリオがある場合は、安全側に倒して削除しない', () => {
    const r = removalCheck(fitness, {
      ...STRATEGY,
      businessPortfolio: { ...STRATEGY.businessPortfolio, threshold: { growthBaseline: 5, profitBaseline: 0 } },
    } as never);
    expect(r.ok ? '' : r.reason).toContain('自動生成の内容と一致せず');
  });

  it('事業別の財務データがある事業は削除しない', () => {
    const r = removalCheck(fitness, { ...STRATEGY, segmentPL: { フィットネス: [{ year: 2025, revenue: 1 }] } } as never);
    expect(r.ok ? '' : r.reason).toContain('事業別の財務データ（2025年度）');
  });

  it('財務の確定状態に残っている事業は削除しない', () => {
    const r = removalCheck(fitness, { ...STRATEGY, financeUnitConfirmed: { segmentPL: ['seg-2'] } } as never);
    expect(r.ok ? '' : r.reason).toContain('確定状態');
  });

  it('部門名が事業名と同じ場合も、紐づきとして削除しない', () => {
    const r = removalCheck(fitness, { ...STRATEGY, departments: [{ name: 'フィットネス', mission: '', projects: [], finalized: false }] } as never);
    expect(r.ok ? '' : r.reason).toContain('事業名と同じ部門');
  });

  it('経営課題が事業に紐づいていれば、事業を削除しない', () => {
    const r = removalCheck(fitness, {
      ...STRATEGY,
      stage1Issues: [{ title: '新規顧客の獲得が鈍い', segmentName: 'フィットネス' }],
    } as never);
    expect(r.ok ? '' : r.reason).toContain('経営課題「新規顧客の獲得が鈍い」（この事業に紐づけ）');
  });

  it('企業の目標やプロジェクトに紐づく経営課題は削除しない', () => {
    const r = removalCheck({ kind: 'issue.remove', title: '離脱' }, STRATEGY as never);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toContain('企業の目標「売上を伸ばす」');
    expect(r.ok ? '' : r.reason).toContain('プロジェクト（p1）');
  });

  it('紐づきの形式を確認できない場合は、安全に判定できないと伝え、削除しない', () => {
    const r = removalCheck(newCustomer, { ...STRATEGY, companyTargets: {} } as never);
    expect(r.ok ? '' : r.reason).toContain('形式を確認できない');
  });

  it('IDと名前が一致しない事業は、対象が見つからないとして削除しない', () => {
    const r = removalCheck({ kind: 'segment.remove', id: 'seg-9', name: 'フィットネス' }, STRATEGY as never);
    expect(r.ok ? '' : r.reason).toContain('見つかりません');
  });
});

describe('③ 他の事業や経営課題のデータに影響しない', () => {
  it('製造事業に紐づいていても、フィットネスの削除は影響を受けない', () => {
    expect(removalCheck(fitness, STRATEGY as never)).toEqual({ ok: true });
  });

  it('プロジェクトに紐づく経営課題があっても、別の経営課題は削除できる', () => {
    expect(removalCheck(newCustomer, STRATEGY as never)).toEqual({ ok: true });
  });
});
