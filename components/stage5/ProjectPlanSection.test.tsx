/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { LoadOutcome, PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';

const CO = '00000000-0000-4000-8000-00000000c0de';
const ST = '00000000-0000-4000-8000-0000000057a1';
const RENEWAL = 'fict-proj-renewal';

process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = 'true';

const mockStoreState: Record<string, unknown> = {};
const mockUserState = { user: { id: 'user-manager' }, role: 'manager' };
let mockLoad: (key: PlanDocKey) => Promise<LoadOutcome> = async () => ({ status: 'NONE' });
const mockDownload = jest.fn(async (_input: unknown) => undefined);

jest.doMock('@/store/strategyStore', () => ({
  useStrategyStore: (selector: (s: unknown) => unknown) => selector(mockStoreState),
}));
jest.doMock('@/store/userStore', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector(mockUserState),
}));
jest.doMock('@/components/okr/execution-plan/planStores', () => ({
  currentPlanStoreKind: () => 'remote',
  planStoreFor: () => ({ load: (_actor: unknown, key: PlanDocKey) => mockLoad(key) }),
}));
jest.doMock('@/lib/stage4/plan/projectPlanPdf', () => ({
  downloadProjectPlanPdf: (input: unknown) => mockDownload(input),
}));
jest.doMock('@/components/stage5/ActionProgressEditor', () => {
  const { createElement: h } = require('react');
  return {
    ActionProgressEditor: ({ actions }: { actions: Array<{ actionKey: string; title: string }> }) =>
      h('ul', null, actions.map((a) => h('li', { key: a.actionKey }, a.title))),
  };
});

const ProjectPlanSection = require('./ProjectPlanSection').default as (props: Record<string, unknown>) => JSX.Element;

let started: PlanDocRecord;
beforeAll(async () => {
  const strategy = { ...JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])), id: ST, company_id: CO, revision: 3 };
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(strategy)),
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: RENEWAL,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: '2026-11-10T00:00:00.000Z',
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  Object.assign(mockStoreState, { companyId: CO, strategyId: ST, companyName: '架空株式会社', departments: strategy.departments });

  const key: PlanDocKey = { companyId: CO, strategyId: ST, projectId: RENEWAL };
  started = {
    key,
    version: 4,
    aiDraft: r.bundle,
    userEdits: { 'action:1:title': '実施事項：更新案内の一斉送付', responsible: '佐藤（仮）' },
    adopted: true,
    updatedAt: '2026-11-11T09:00:00.000Z',
    updatedBy: 'user-manager',
    status: 'DRAFT',
    adoption: { version: 3, byUserId: 'user-manager', at: '2026-11-11T08:00:00.000Z', edits: {} },
    startInfo: { version: 4, byUserId: 'user-manager', at: '2026-11-11T09:00:00.000Z' },
    regulatory: undefined,
  };
  mockLoad = async (k) =>
    k.companyId === key.companyId && k.strategyId === key.strategyId && k.projectId === key.projectId
      ? { status: 'FOUND', record: started }
      : { status: 'NONE' };
});

const props = (over: Record<string, unknown> = {}) => ({
  companyId: CO,
  strategyId: ST,
  projectId: RENEWAL,
  departmentName: '営業部',
  projectTitle: '既存顧客の保守契約更新',
  userId: 'user-manager',
  ...over,
});

describe('STAGE5 のプロジェクトモーダル：実行開始済みの計画（読み取り専用）', () => {
  beforeEach(() => mockDownload.mockClear());

  it('開始したプロジェクトの責任者と実施事項を表示し、計画の詳細（目的・KPI）は表示しない', async () => {
    render(createElement(ProjectPlanSection as never, props()));
    expect(await screen.findByText(/実行計画（STAGE4・実行開始済み）/)).not.toBeNull();
    expect(screen.getByText(/責任者：鈴木一郎（仮）|責任者：/)).not.toBeNull();
    expect(screen.getByText('実施事項：更新案内の一斉送付')).not.toBeNull();
    expect(screen.queryByText('計画の詳細（目的・KPI）')).toBeNull();
    expect(screen.queryByText('保守契約の継続率')).toBeNull();
  });

  it('子要素（今、困っていること）は、計画の有無にかかわらず、実施事項より上に表示される', async () => {
    const child = createElement('div', { 'data-testid': 'consult' }, '今、困っていること');
    const { container } = render(createElement(ProjectPlanSection as never, props(), child));
    expect(await screen.findByText(/実行計画（STAGE4・実行開始済み）/)).not.toBeNull();
    const consult = screen.getByTestId('consult');
    const action = screen.getByText('実施事項：更新案内の一斉送付');
    expect(consult.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.contains(consult)).toBe(true);
  });

  it('計画がなくても、子要素（今、困っていること）は表示される', async () => {
    mockLoad = async () => ({ status: 'NONE' });
    const child = createElement('div', { 'data-testid': 'consult-none' }, '今、困っていること');
    render(createElement(ProjectPlanSection as never, props(), child));
    expect(await screen.findByText(/実行開始済みの計画はまだありません/)).not.toBeNull();
    expect(screen.getByTestId('consult-none')).not.toBeNull();
  });

  it('実行開始していない計画は、計画の内容を表示せず、開始の案内を出す', async () => {
    mockLoad = async () => ({ status: 'NONE' });
    render(createElement(ProjectPlanSection as never, props()));
    expect(await screen.findByText(/実行開始済みの計画はまだありません/)).not.toBeNull();
    expect(screen.queryByText('保守契約の継続率')).toBeNull();
  });

  it('同じIDのプロジェクトが複数ある場合は、どの計画か特定できないため表示しない', async () => {
    const original = mockStoreState.departments;
    mockStoreState.departments = [
      { name: '営業部', projects: [{ id: RENEWAL, title: 'A' }] },
      { name: '企画部', projects: [{ id: RENEWAL, title: 'B' }] },
    ];
    try {
      render(createElement(ProjectPlanSection as never, props()));
      expect(await screen.findByText(/同じIDのプロジェクトがあるため/)).not.toBeNull();
      expect(screen.queryByText('保守契約の継続率')).toBeNull();
    } finally {
      mockStoreState.departments = original;
    }
  });

  it('実行計画書のPDFは、ボタンを押したときだけ、保存済みの計画から作る', async () => {
    mockLoad = async (k) => ({ status: 'FOUND', record: { ...started, key: k } });
    render(createElement(ProjectPlanSection as never, props()));
    const button = await screen.findByRole('button', { name: '実行計画書をPDFで開く' });
    expect(mockDownload).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByRole('button', { name: '実行計画書をPDFで開く' });
    expect(mockDownload).toHaveBeenCalledTimes(1);
    const input = mockDownload.mock.calls[0][0] as { companyName: string; userEdits: Record<string, unknown>; startInfo: { version: number } };
    expect(input.companyName).toBe('架空株式会社');
    expect(input.userEdits['action:1:title']).toBe('実施事項：更新案内の一斉送付');
    expect(input.startInfo.version).toBe(4);
  });
});
