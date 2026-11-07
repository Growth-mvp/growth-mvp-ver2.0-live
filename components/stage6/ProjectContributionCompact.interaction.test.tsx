/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ProjectContributionCompact, type ContributionRow } from './ProjectContributionCompact';

const row = (n: number): ContributionRow => ({
  key: `p${n}`,
  dept: '営業部',
  proj: `P${n}`,
  investTotal: 0,
  krCount: 1,
  deltaRevenueTotal: n * 10,
  deltaOpTotal: n,
  targetRevenueMJPY: 100,
  targetOpIncomeMJPY: 10,
});

describe('ProjectContributionCompact（操作）', () => {
  it('6件以上では「全N件を表示」で全件が開き、もう一度押すと上位5件に戻る', () => {
    render(<ProjectContributionCompact projectContrib={[1, 2, 3, 4, 5, 6, 7].map(row)} />);
    const items = () => document.querySelectorAll('section[aria-label="プロジェクト寄与"] ul > li').length;
    expect(items()).toBe(5);
    const expand = screen.getByRole('button', { name: '全7件を表示' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      fireEvent.click(expand);
    });
    expect(items()).toBe(7);
    expect(screen.getByRole('button', { name: '上位5件に戻す' }).getAttribute('aria-expanded')).toBe('true');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '上位5件に戻す' }));
    });
    expect(items()).toBe(5);
  });
});
