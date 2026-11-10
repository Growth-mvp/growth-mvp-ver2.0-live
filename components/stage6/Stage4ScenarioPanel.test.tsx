/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { estimateProjectImpact } from '@/lib/stage4/planView/impactEstimate';
import type { ScenarioRow } from '@/lib/stage4/planView/scenarioRows';
import { Stage4ScenarioTable } from './Stage4ScenarioPanel';

const estimate = estimateProjectImpact(
  { role: 'COST', impactAssumptions: undefined, okrsV2: [] },
  { hypothesis: { customers: 10, rate: 20, deal: 10, grossMarginPct: 30, addCostMJPY: 2 } }
);

const rows: ScenarioRow[] = [
  {
    deptName: '営業部',
    projectTitle: '仮説の案件',
    projectId: 'p-1',
    stateLabel: '草案（未採用）',
    estimate,
    overlapNote: null,
  },
  {
    deptName: '営業部',
    projectTitle: '前提のある案件',
    projectId: 'p-2',
    stateLabel: '採用済み（正式な計画には未反映）',
    estimate: { status: 'NOT_CALCULATED', reason: 'x', params: [] },
    overlapNote: 'STAGE3の業績インパクトと同じ効果の可能性があるため、合計には含めていない',
  },
];

describe('Stage4ScenarioTable（STAGE6の参考シナリオ）', () => {
  it('案件ごとに参考値を表示し、合計は作らない', () => {
    render(<Stage4ScenarioTable rows={rows} />);
    expect(screen.getByText('STAGE4の参考シナリオ（合計には加算しない）')).toBeTruthy();
    expect(screen.getByText('仮説の案件')).toBeTruthy();
    expect(screen.getByText('20百万円')).toBeTruthy();
    expect(screen.getByText('草案（未採用）')).toBeTruthy();
    expect(screen.getByText(/合計には含めていない/)).toBeTruthy();
    expect(screen.queryByText(/合計額|合計：/)).toBeNull();
  });

  it('計画書が無い場合は、その旨を示す', () => {
    render(<Stage4ScenarioTable rows={[]} />);
    expect(screen.getByText('STAGE4で計画書を作った案件はまだありません。')).toBeTruthy();
  });

  it('仮説の出所を、AIの仮説（未確認）と示す', () => {
    render(<Stage4ScenarioTable rows={rows.slice(0, 1)} />);
    expect(screen.getAllByText(/AIの仮説（未確認）/).length).toBeGreaterThan(0);
  });
});
