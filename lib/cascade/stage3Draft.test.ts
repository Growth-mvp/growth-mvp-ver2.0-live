import { draftDepartmentsFrom } from './stage3Draft';
import { emptyWorkspaceState, verifyWorkspaceState, type WorkspaceState } from './stage3StrategyBook';

const official = [
  {
    id: 'd-sales',
    name: '営業部',
    projects: [
      {
        id: 'p-existing',
        title: '既存の保守を強化',
        reason: '既存顧客の再発注を増やす',
        hypothesis: '点検の提案で稼働率が上がる',
        sourceType: 'existing',
        partnerDepartment: '',
        okrs: [
          { id: 'x1', objective: '再発注を増やす', keyResults: ['再発注率を20%にする', '提案件数を月10件にする'], due: '2027-03' },
        ],
        kpis: ['再発注率'],
      },
    ],
  },
];

const candidates = {
  'id:d-sales': [
    {
      id: 'p-new',
      title: '新市場の探索',
      reason: '新しい顧客層へ広げる',
      hypothesis: '医療分野で需要がある',
      sourceType: 'interCollab',
      partnerDepartment: '開発部',
      okrs: [{ objective: '新規顧客を開く', keyResults: ['新規商談を5件'] }],
    },
  ],
};

describe('draftDepartmentsFrom（草案に計画の詳細を残す）', () => {
  it('正式データの計画も候補の計画も、選定理由・仮説・分類・連携先・目標を草案に残す', () => {
    const [dept] = draftDepartmentsFrom(official, candidates);
    const existing = dept.projects.find((p) => p.id === 'p-existing');
    const added = dept.projects.find((p) => p.id === 'p-new');

    expect(existing).toMatchObject({
      title: '既存の保守を強化',
      reason: '既存顧客の再発注を増やす',
      hypothesis: '点検の提案で稼働率が上がる',
      sourceType: 'existing',
      okrs: [{ objective: '再発注を増やす', keyResults: ['再発注率を20%にする', '提案件数を月10件にする'] }],
    });
    expect(existing?.partnerDepartment).toBeUndefined();
    expect(added).toMatchObject({
      reason: '新しい顧客層へ広げる',
      hypothesis: '医療分野で需要がある',
      sourceType: 'interCollab',
      partnerDepartment: '開発部',
      okrs: [{ objective: '新規顧客を開く', keyResults: ['新規商談を5件'] }],
    });
  });

  it('目標の期限など、草案に不要な項目は残さない', () => {
    const [dept] = draftDepartmentsFrom(official, candidates);
    const existing = dept.projects.find((p) => p.id === 'p-existing') as unknown as { okrs: Array<Record<string, unknown>> };
    expect(existing.okrs[0]).not.toHaveProperty('due');
    expect(existing.okrs[0]).not.toHaveProperty('id');
  });

  it('保存時の検証（保存と読み込み）を通っても、詳細は消えない', () => {
    const [dept] = draftDepartmentsFrom(official, candidates);
    const state: WorkspaceState = {
      ...emptyWorkspaceState(),
      drafts: [
        {
          draftId: 'draft-test1',
          kind: 'initial',
          version: 1,
          createdAt: '2026-11-12T00:00:00.000Z',
          departments: [dept],
          newProjects: [],
          generatedDepartmentKeys: ['id:d-sales'],
        },
      ],
    };
    const verified = verifyWorkspaceState(state, official);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const saved = verified.state.drafts[0].departments[0].projects.find((p) => p.id === 'p-new');
    expect(saved).toMatchObject({
      reason: '新しい顧客層へ広げる',
      hypothesis: '医療分野で需要がある',
      partnerDepartment: '開発部',
    });
  });
});
