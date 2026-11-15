/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import PlanDocument, { type PlanDocumentProps } from './PlanDocument';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const PROJ = 'fict-proj-renewal';

let bundle: Record<string, unknown> = {};
beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])),
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: PROJ,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: '2026-11-10T00:00:00.000Z',
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  bundle = r.bundle;
});

function props(over: Partial<PlanDocumentProps> = {}): PlanDocumentProps {
  return {
    bundle,
    mode: 'read',
    committed: {},
    draft: {},
    adopted: false,
    adoptable: true,
    blockers: [],
    notice: null,
    persisted: true,
    directEdit: true,
    onDirectChange: jest.fn(),
    onEnterEdit: jest.fn(),
    onApply: jest.fn(),
    onDiscard: jest.fn(),
    onDraftChange: jest.fn(),
    onAdopt: jest.fn(),
    onUnadopt: jest.fn(),
    onOpenStart: jest.fn(),
    ...over,
  };
}

describe('PlanDocument（直接編集の文書）', () => {
  it('実施事項の主な内容・担当・成果物・実行責任者も、文書上で直接編集できる', () => {
    const p = props();
    render(<PlanDocument {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '実施事項1の主な内容を修正する' }));
    fireEvent.change(screen.getByLabelText('実施事項1の主な内容'), { target: { value: '新しい主な内容' } });
    expect(p.onDirectChange).toHaveBeenLastCalledWith('action:1:content', '新しい主な内容');
    fireEvent.click(screen.getByRole('button', { name: '実施事項1の担当を修正する' }));
    fireEvent.change(screen.getByLabelText('実施事項1の担当'), { target: { value: '営業部長（仮）' } });
    expect(p.onDirectChange).toHaveBeenLastCalledWith('action:1:owner', '営業部長（仮）');
    expect(screen.getByRole('button', { name: '実行責任者を修正する' })).toBeTruthy();
  });

  it('文章をクリックすると、そのまま修正として書かれ、修正の反映の操作は出ない', () => {
    const p = props();
    render(<PlanDocument {...p} />);
    expect(screen.queryByRole('button', { name: '計画書を修正する' })).toBeNull();
    expect(screen.queryByRole('button', { name: '修正を反映する' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '取り組む理由を修正する' }));
    fireEvent.change(screen.getByLabelText('取り組む理由'), { target: { value: '新しい理由' } });
    expect(p.onDirectChange).toHaveBeenLastCalledWith(expect.any(String), '新しい理由');
    expect(p.onDraftChange).not.toHaveBeenCalled();
  });

  it('採用の欄は出さず、「実行を開始する」だけで実行開始の画面へ進む', () => {
    const p = props();
    render(<PlanDocument {...p} />);
    expect(screen.queryByText('この計画書を採用（採用のみ）')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '実行を開始する' }));
    expect(p.onOpenStart).toHaveBeenCalledTimes(1);
  });

  it('財務効果の入力欄は、「財務効果を設定する」を開くまで閉じている', () => {
    const { container } = render(<PlanDocument {...props({ financeSection: <p>財務効果の入力欄</p> })} />);
    const toggle = container.querySelector('details.plan-finance-toggle') as HTMLDetailsElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.open).toBe(false);
    expect(screen.getByText('財務効果を設定する')).toBeTruthy();
  });
});

describe('PlanDocument（STAGE3由来KPIの期限の入力）', () => {
  it('期限が未設定で判定時期の候補があるKPIでも、選んだ年月は反映後に入力欄へ残る', async () => {
    const source = JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0]));
    for (const d of source.departments) {
      for (const p of d.projects) {
        if (p.id !== PROJ) continue;
        p.okrsV2 = (p.okrsV2 ?? []).map((k: Record<string, unknown>) => ({ ...k, due: null }));
      }
    }
    const r = await generateMockExecutionPlan({
      strategy: source,
      membershipCompanyId: CO,
      requestedStrategyId: ST,
      requestedProjectId: PROJ,
      currentYm: '2026-11',
      companyName: '架空',
      createdAt: '2026-11-10T00:00:00.000Z',
    });
    if (r.status !== 'READY') throw new Error('mock draft must be ready');
    const kpi = buildDocModel(r.bundle, {}).goals.kpis.find((k) => k.confirmed && k.dueKey && k.due.includes('判定時期'));
    expect(kpi).toBeTruthy();
    const label = `${kpi!.label}の期限`;
    const p = props({ bundle: r.bundle });
    const { rerender } = render(<PlanDocument {...p} />);
    fireEvent.click(screen.getByRole('button', { name: `${label}を修正する` }));
    fireEvent.change(screen.getByLabelText(label), { target: { value: '2027-01' } });
    expect(p.onDirectChange).toHaveBeenLastCalledWith(kpi!.dueKey, '2027-01');

    rerender(<PlanDocument {...p} committed={{ [kpi!.dueKey!]: '2027-01' }} />);
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('2027-01');
  });
});
