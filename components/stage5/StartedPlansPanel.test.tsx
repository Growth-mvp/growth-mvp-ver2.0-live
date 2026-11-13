/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { LoadOutcome, PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';

const CO = '00000000-0000-4000-8000-00000000c0de';
const ST = '00000000-0000-4000-8000-0000000057a1';
const RENEWAL = 'fict-proj-renewal';

process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = 'true';

/* 変換の都合で、モックは取り込みの前に登録し、部品は登録の後に読み込む */
const mockStoreState: Record<string, unknown> = {};
const mockUserState = { user: { id: 'user-manager' }, role: 'manager' };
let mockLoad: (key: PlanDocKey) => Promise<LoadOutcome> = async () => ({ status: 'NONE' });

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
jest.doMock('@/components/stage5/ActionProgressEditor', () => ({
  ActionProgressEditor: ({ actions }: { actions: Array<{ actionKey: string; title: string }> }) =>
    createElement('ul', null, actions.map((a) => createElement('li', { key: a.actionKey }, a.title))),
}));

const StartedPlansPanel = require('./StartedPlansPanel').default as () => JSX.Element;

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
  Object.assign(mockStoreState, { companyId: CO, strategyId: ST, departments: strategy.departments });

  const key: PlanDocKey = { companyId: CO, strategyId: ST, projectId: RENEWAL };
  const started: PlanDocRecord = {
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

describe('STAGE5：実行開始済みの計画を、対象プロジェクトのKPIとともに表示する', () => {
  it('開始したプロジェクトの計画を、担当・KPI（目標・期限）・実施事項つきで表示する', async () => {
    render(createElement(StartedPlansPanel));
    expect(await screen.findByText('実行計画（STAGE4・実行開始済み）')).not.toBeNull();
    expect(await screen.findByRole('heading', { name: '既存顧客の保守契約更新' })).not.toBeNull();
    expect(screen.getByText(/佐藤（仮）/)).not.toBeNull();
    expect(screen.getByText('保守契約の継続率')).not.toBeNull();
    expect(screen.getByText('2027年6月')).not.toBeNull();
    expect(screen.getByText('実施事項：更新案内の一斉送付')).not.toBeNull();
  });

  it('実行開始していない計画は、STAGE5に表示しない', async () => {
    mockLoad = async () => ({ status: 'NONE' });
    render(createElement(StartedPlansPanel));
    expect(await screen.findByText('実行開始済みの計画はまだありません。')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: '既存顧客の保守契約更新' })).toBeNull();
  });
});
