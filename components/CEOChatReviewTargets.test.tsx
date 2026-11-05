/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import CEOChatReviewTargets from './CEOChatReviewTargets';
import type { ReviewTarget } from '@/lib/ceoChat/reviewTargets';

const target = (over: Partial<ReviewTarget> = {}): ReviewTarget => ({
  stage: 4,
  candidateId: 'r1',
  strategyId: 'strategy-1',
  label: '新規開拓のKPIを確認',
  href: '/okr?projectId=proj-new&deptId=dept-sales',
  projectTitle: '新規開拓',
  departmentName: '営業部',
  checkItems: ['KPI・目標値'],
  ...over,
});

describe('CEOChatReviewTargets', () => {
  const originalFetch = (global as any).fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('STAGE4の案件名・確認項目・プロジェクトを開くリンクを表示する', () => {
    render(<CEOChatReviewTargets targets={[target()]} currentStrategyId="strategy-1" />);
    expect(screen.getByText('STAGE4｜実行計画')).toBeTruthy();
    expect(screen.getByText('新規開拓')).toBeTruthy();
    expect(screen.getByText(/確認する項目：KPI・目標値/)).toBeTruthy();
    const link = screen.getByRole('link', { name: '該当プロジェクトを開く' });
    expect(link.getAttribute('href')).toBe('/okr?projectId=proj-new&deptId=dept-sales');
  });

  it('現在の戦略と一致しない案内は表示しない（戦略・企業の切替後に残らない）', () => {
    const { container } = render(
      <CEOChatReviewTargets targets={[target({ strategyId: 'old-strategy' })]} currentStrategyId="strategy-1" />
    );
    expect(container.innerHTML).toBe('');
  });

  it('案内が無い場合は何も表示しない', () => {
    const { container } = render(<CEOChatReviewTargets targets={[]} currentStrategyId="strategy-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('表示だけでは通信しない（保存処理は走らない）', () => {
    render(<CEOChatReviewTargets targets={[target()]} currentStrategyId="strategy-1" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
