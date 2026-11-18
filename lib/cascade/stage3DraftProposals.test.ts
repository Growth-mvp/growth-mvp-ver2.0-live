import { projectProposalsAfterRegeneration } from './stage3Draft';
import type { ProjectProposal } from './stage3StrategyBook';

const official = [
  { id: 'd-a', name: '営業部', projects: [{ id: 'p1', title: '既存顧客の再発注', reason: '旧い理由', okrsV2: [{ id: 'kr-1', label: '再発注率（％）' }] }] },
  { id: 'd-b', name: '製造部', projects: [{ id: 'p2', title: '歩留まりの改善', reason: '旧い理由' }] },
];

const fields = (title: string, reason: string | null) => ({ title, reason, hypothesis: null, description: null, kpis: [] });

const proposal = (departmentKey: string, departmentName: string, projectId: string, title: string, decision: ProjectProposal['decision']): ProjectProposal => ({
  departmentKey,
  departmentName,
  projectId,
  projectTitle: title,
  reason: '前の判断',
  base: fields(title, '旧い理由'),
  proposed: fields(title, '別の理由'),
  decision,
});

describe('再生成で変えるのは再生成した部門の変更案だけ', () => {
  const previous = [
    proposal('id:d-a', '営業部', 'p1', '既存顧客の再発注', 'pending'),
    proposal('id:d-b', '製造部', 'p2', '歩留まりの改善', 'adopted'),
  ];

  it('他の部門の採用済みの変更案は、再生成の後も残る', () => {
    const next = projectProposalsAfterRegeneration(previous, new Set(['id:d-a']), official, {
      'id:d-a': [{ title: '既存顧客の再発注', reason: '再生成の理由' }],
    });
    const other = next.find((p) => p.departmentKey === 'id:d-b');
    expect(other).toEqual(previous[1]);
  });

  it('再生成した部門の変更案は、新しい案に置き換わる（古い保留は残らない）', () => {
    const next = projectProposalsAfterRegeneration(previous, new Set(['id:d-a']), official, {
      'id:d-a': [{ title: '既存顧客の再発注', reason: '再生成の理由' }],
    });
    const mine = next.filter((p) => p.departmentKey === 'id:d-a');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ projectId: 'p1', reason: expect.any(String), decision: 'pending' });
    expect(mine[0].proposed.reason).toBe('再生成の理由');
  });

  it('再生成した部門に改善がなければ、その部門の変更案は空になる（他部門は残る）', () => {
    const next = projectProposalsAfterRegeneration(previous, new Set(['id:d-a']), official, {});
    expect(next.map((p) => p.departmentKey)).toEqual(['id:d-b']);
  });
});
