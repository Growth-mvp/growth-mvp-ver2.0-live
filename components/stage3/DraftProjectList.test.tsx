/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { DraftProjectList } from './DraftProjectList';

const official = [
  {
    id: 'p1',
    title: '既存の保守を強化',
    reason: '既存顧客の再発注を増やす',
    hypothesis: '点検の提案で稼働率が上がる',
    sourceType: 'existing',
    okrs: [{ objective: '再発注を増やす', keyResults: ['再発注率を20%にする'] }],
  },
  {
    id: 'p2',
    title: '工場間の連携',
    reason: '',
    hypothesis: '工場の在庫が見える',
    sourceType: 'interCollab',
    partnerDepartment: '生産',
  },
];

const draft = [
  { id: 'p1', title: '既存の保守を強化', description: '要約1' },
  { id: 'p2', title: '工場間の連携', description: '要約2' },
  { id: 'p3', title: '照合できない案', description: '草案の要約' },
];

describe('DraftProjectList', () => {
  it('全件を分類ごとに見出し付きで表示し、件数を示す', () => {
    render(<DraftProjectList projects={draft} official={official} candidates={[]} />);
    expect(screen.getByText('既存事業強化')).toBeTruthy();
    expect(screen.getByText('部門間連携')).toBeTruthy();
    expect(screen.getByText('その他')).toBeTruthy();
    expect(screen.getByText('既存の保守を強化')).toBeTruthy();
    expect(screen.getByText('工場間の連携')).toBeTruthy();
    expect(screen.getByText('照合できない案')).toBeTruthy();
  });

  it('各プロジェクトは個別に開閉でき、初期状態では閉じている', () => {
    const { container } = render(<DraftProjectList projects={draft} official={official} candidates={[]} />);
    const items = Array.from(container.querySelectorAll('details')) as HTMLDetailsElement[];
    expect(items).toHaveLength(3);
    expect(items.every((d) => d.open === false)).toBe(true);
  });

  it('選定理由が空なら仮説を「狙い」として出さず、仮説は仮説として出す', () => {
    render(<DraftProjectList projects={draft} official={official} candidates={[]} />);
    expect(screen.getByText('工場の在庫が見える')).toBeTruthy();
    expect(screen.queryByText('工場の在庫が見える', { selector: '.text-xs' })).toBeNull();
    expect(screen.getByText('生産')).toBeTruthy();
  });

  it('照合できない案には、無い項目を補完しない（要約だけを出す）', () => {
    const { container } = render(
      <DraftProjectList projects={[{ id: 'p3', title: '照合できない案', description: '草案の要約' }]} official={official} candidates={[]} />,
    );
    expect(screen.getByText('草案の要約')).toBeTruthy();
    expect(container.textContent).not.toContain('狙い・選定理由');
    expect(container.textContent).not.toContain('施策と期待成果の仮説');
    expect(container.textContent).not.toContain('（未設定）');
  });
});
