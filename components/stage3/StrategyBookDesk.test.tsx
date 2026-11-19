/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { emptyWorkspaceState, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';
import type { Department } from '@/types/strategy';
import type { StrategyBookGate } from './StrategyBookDesk';

const mockAuthFetchJson = jest.fn();
jest.doMock('@/utils/authFetch', () => ({
  authFetchJson: (...args: unknown[]) => mockAuthFetchJson(...args),
  AuthFetchError: class AuthFetchError extends Error {
    bodyText?: string;
  },
}));
jest.doMock('@/hooks/useConsultFocus', () => ({ useConsultFocus: () => undefined }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { StrategyBookDesk } = require('./StrategyBookDesk') as typeof import('./StrategyBookDesk');

const DEPT = { name: '営業部', mission: '顧客を広げる', projects: [] } as unknown as Department;
const DEPT_KEY = 'name:営業部';

function stateWithRegeneratedDraft(): WorkspaceState {
  const initial = {
    draftId: 'draft-initial1',
    kind: 'initial',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    departments: [{ ...DEPT }],
    newProjects: [],
    generatedDepartmentKeys: [DEPT_KEY],
  };
  const regenerated = {
    draftId: 'draft-regen1',
    kind: 'regenerated',
    version: 2,
    createdAt: '2026-01-02T00:00:00.000Z',
    departments: [{ ...DEPT }],
    newProjects: [
      {
        candidateId: 'np-1',
        departmentKey: DEPT_KEY,
        project: { title: '新規A', reason: '理由', hypothesis: '仮説', description: '内容' },
      },
    ],
    generatedDepartmentKeys: [DEPT_KEY],
  };
  return {
    ...emptyWorkspaceState(),
    drafts: [initial, regenerated],
    projectSelections: [
      { departmentKey: DEPT_KEY, departmentName: '営業部', candidateId: 'np-1', title: '新規A', decision: 'pending' },
    ],
  } as unknown as WorkspaceState;
}

function serverResponse(state: WorkspaceState) {
  return {
    ok: true,
    version: 5,
    state,
    legacySettled: { applied: 0, discarded: 0 },
    revision: 1,
    stage2Status: 'confirmed',
    companyStrategy: '全社戦略',
  };
}

const gate: () => StrategyBookGate = () => ({ ok: true, companyId: 'c1', strategyId: 's1', revision: 1 });

function renderDesk(departments: unknown[] = [DEPT]) {
  return render(
    <StrategyBookDesk
      departments={departments as never}
      canEdit
      canManageDepartments={false}
      getWriteGate={gate}
      readCompanyId="c1"
      readStrategyId="s1"
      generateDepartment={jest.fn(async () => null)}
      renderSixQuestions={() => null}
      onConfirmed={jest.fn()}
      onExportDepartment={jest.fn(async () => undefined)}
      onAddDepartment={jest.fn(async () => true)}
      onRenameDepartment={jest.fn(async () => true)}
      onDeleteDepartment={jest.fn(async () => true)}
    />,
  );
}

function mockServer(state: WorkspaceState) {
  mockAuthFetchJson.mockReset();
  mockAuthFetchJson.mockImplementation(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'PUT') return { ok: true, version: 6 };
    return serverResponse(state);
  });
}

function putBodies(): Array<{ state: WorkspaceState }> {
  return mockAuthFetchJson.mock.calls
    .filter(([, init]) => (init as { method?: string } | undefined)?.method === 'PUT')
    .map(([, init]) => (init as { json: { state: WorkspaceState } }).json);
}

describe('STEP4の重点プロジェクトの採否', () => {
  it('採用を押すと、その判断を保存へ送る', async () => {
    mockServer(stateWithRegeneratedDraft());
    renderDesk();

    await waitFor(() => expect((screen.getByRole('button', { name: /^STEP4/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /^STEP4/ }));

    const title = await screen.findByText('新規A');
    const card = title.closest('div.rounded-xl') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: '採用する' }));

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0].state.projectSelections[0].decision).toBe('applied');
  });

  it('書き込みを待つ理由がある間は採否を押せず、理由を出す', async () => {
    mockServer(stateWithRegeneratedDraft());
    render(
      <StrategyBookDesk
        departments={[DEPT]}
        canEdit
        canManageDepartments={false}
        getWriteGate={() => ({ ok: false, reason: '未保存の変更があるため、保存を完了してから操作してください。' })}
        readCompanyId="c1"
        readStrategyId="s1"
        generateDepartment={jest.fn(async () => null)}
        renderSixQuestions={() => null}
        onConfirmed={jest.fn()}
        onExportDepartment={jest.fn(async () => undefined)}
        onAddDepartment={jest.fn(async () => true)}
        onRenameDepartment={jest.fn(async () => true)}
        onDeleteDepartment={jest.fn(async () => true)}
      />,
    );
    await waitFor(() => expect((screen.getByRole('button', { name: /^STEP4/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /^STEP4/ }));
    const card = (await screen.findByText('新規A')).closest('div.rounded-xl') as HTMLElement;
    expect((within(card).getByRole('button', { name: '採用する' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/未保存の変更があるため、保存を完了してから操作してください/)).toBeTruthy();
  });
});

const OTHER_DEPT = { name: '開発部', mission: '製品を届ける', projects: [] };
const OTHER_KEY = 'name:開発部';
const LONG_PROPOSAL = '第一に、営業部と開発部の計画が同じ顧客を狙っています。第二に、役割を分けると両方の成果が上がります。第三に、四半期ごとに見直す必要があります。';

function stateWithAnalysis(options: { withProposal: boolean; analysis: boolean }): WorkspaceState {
  const base = stateWithRegeneratedDraft();
  const draftWithOther = (draft: Record<string, unknown>) => ({
    ...draft,
    departments: [{ ...DEPT }, { ...OTHER_DEPT }],
    generatedDepartmentKeys: [DEPT_KEY, OTHER_KEY],
  });
  const drafts = base.drafts.map((d) => draftWithOther(d as unknown as Record<string, unknown>));
  const candidate = {
    id: 'adj-1',
    kind: 'duplicate',
    title: '顧客の重複',
    summary: '同じ顧客を狙っています。',
    dialogueTopics: ['役割の分担'],
    departments: [
      { departmentKey: DEPT_KEY, name: '営業部' },
      { departmentKey: OTHER_KEY, name: '開発部' },
    ],
    planRefs: [{ departmentKey: DEPT_KEY, projectId: 'p1', departmentName: '営業部', projectTitle: '新規A' }],
  };
  return {
    ...base,
    drafts,
    analysis: options.analysis
      ? {
          draftId: 'draft-regen1',
          draftVersion: 2,
          createdAt: '2026-01-03T00:00:00.000Z',
          candidates: [candidate],
          rejectedCandidates: 0,
          rejectedReferences: 0,
        }
      : null,
    adjustmentProposals: options.withProposal
      ? [{ candidateId: 'adj-1', proposal: LONG_PROPOSAL, changes: [] }]
      : [],
  } as unknown as WorkspaceState;
}

function renderWithOtherDept(state: WorkspaceState) {
  mockServer(state);
  renderDesk([DEPT, OTHER_DEPT]);
}

describe('確定条件（課題10）', () => {
  it('2部門以上で部門間調整が未分析なら、確定ボタンを押せず理由を出す', async () => {
    renderWithOtherDept(stateWithAnalysis({ withProposal: false, analysis: false }));
    fireEvent.click(await screen.findByRole('button', { name: /部門間調整/ }));
    const button = await screen.findByRole('button', { name: '戦略書を確定する' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/部門間の調整がまだ分析されていません/)).toBeTruthy();
  });

  it('分析済みで調整候補が0件なら、確定ボタンを押せる', async () => {
    const state = stateWithAnalysis({ withProposal: false, analysis: true });
    (state.analysis as unknown as { candidates: unknown[] }).candidates = [];
    renderWithOtherDept(state);
    fireEvent.click(await screen.findByRole('button', { name: /部門間調整/ }));
    const button = await screen.findByRole('button', { name: '戦略書を確定する' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('部門間調整の表示（課題12・15）', () => {
  it('AI調整案は途中で切らずに全文を表示する', async () => {
    renderWithOtherDept(stateWithAnalysis({ withProposal: true, analysis: true }));
    fireEvent.click(await screen.findByRole('button', { name: /部門間調整/ }));
    await screen.findByText(LONG_PROPOSAL, { selector: 'p.leading-6' });
    expect(document.querySelector('p.leading-6')?.textContent).toBe(LONG_PROPOSAL);
  });

  it('AI調整案の生成直後に、採用する・採用しないを押せる', async () => {
    renderWithOtherDept(stateWithAnalysis({ withProposal: true, analysis: true }));
    fireEvent.click(await screen.findByRole('button', { name: /部門間調整/ }));
    const adopt = await screen.findByRole('button', { name: '採用する' });
    await waitFor(() => expect((adopt as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(adopt);
    await waitFor(() => expect(putBodies()).toHaveLength(1));
  });
});

describe('6問の未回答・回答変更後の再生成（課題4）', () => {
  it('回答を保存してから再生成し、書き込みゲートで止めない', async () => {
    const state = stateWithRegeneratedDraft();
    (state as unknown as { drafts: unknown[] }).drafts = [state.drafts[0]];
    mockServer(state);
    let saved = false;
    const prepareRegeneration = jest.fn(async () => {
      saved = true;
      return { ok: true as const };
    });
    const generateDepartment = jest.fn(async () => null);
    render(
      <StrategyBookDesk
        departments={[DEPT]}
        canEdit
        canManageDepartments={false}
        getWriteGate={() =>
          saved ? { ok: true, companyId: 'c1', strategyId: 's1', revision: 1 } : { ok: false, reason: '未保存の変更があります' }
        }
        readCompanyId="c1"
        readStrategyId="s1"
        generateDepartment={generateDepartment}
        prepareRegeneration={prepareRegeneration}
        renderSixQuestions={() => null}
        onConfirmed={jest.fn()}
        onExportDepartment={jest.fn(async () => undefined)}
        onAddDepartment={jest.fn(async () => true)}
        onRenameDepartment={jest.fn(async () => true)}
        onDeleteDepartment={jest.fn(async () => true)}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '6つの問いへ進む' }));
    fireEvent.click(await screen.findByRole('button', { name: '6問を反映して戦略書を再生成' }));

    await waitFor(() => expect(generateDepartment).toHaveBeenCalledTimes(1));
    expect(prepareRegeneration).toHaveBeenCalledTimes(1);
  });
});

describe('手動でプロジェクトを追加（課題No.13）と離脱時の警告（第1弾の残存リスク）', () => {
  it('名称を入れて追加すると、候補として保存され、採否は未判断になる', async () => {
    mockServer(stateWithRegeneratedDraft());
    renderDesk();
    await waitFor(() => expect((screen.getByRole('button', { name: /^STEP4/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /^STEP4/ }));
    fireEvent.click(await screen.findByRole('button', { name: '＋ プロジェクトを追加' }));
    const nameInput = screen.getByLabelText(/プロジェクト名（必須）/) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '手動の新規案' } });
    fireEvent.click(screen.getByRole('button', { name: '追加する' }));

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    const saved = putBodies()[0].state;
    const manual = saved.drafts[saved.drafts.length - 1].newProjects.find((np) => (np.project as { title?: string }).title === '手動の新規案');
    expect(manual?.origin).toBe('manual');
    expect(saved.projectSelections.find((s) => s.title === '手動の新規案')?.decision).toBe('pending');
  });

  it('未保存の編集があるとき、ページを離れる前に警告する', async () => {
    mockServer(stateWithRegeneratedDraft());
    renderDesk();
    await waitFor(() => expect((screen.getByRole('button', { name: /^STEP4/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /^STEP4/ }));
    fireEvent.click(await screen.findByRole('button', { name: '＋ プロジェクトを追加' }));
    fireEvent.change(screen.getByLabelText(/プロジェクト名（必須）/), { target: { value: '入力途中' } });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('事業・部門の追加ボタン（課題8）', () => {
  it('追加の入口は1つだけ', async () => {
    mockServer(stateWithRegeneratedDraft());
    render(
      <StrategyBookDesk
        departments={[]}
        canEdit
        canManageDepartments
        getWriteGate={gate}
        readCompanyId="c1"
        readStrategyId="s1"
        generateDepartment={jest.fn(async () => null)}
        renderSixQuestions={() => null}
        onConfirmed={jest.fn()}
        onExportDepartment={jest.fn(async () => undefined)}
        onAddDepartment={jest.fn(async () => true)}
        onRenameDepartment={jest.fn(async () => true)}
        onDeleteDepartment={jest.fn(async () => true)}
      />,
    );
    await screen.findByRole('button', { name: '事業・部門の追加・管理' });
    expect(screen.queryAllByRole('button', { name: /事業・部門を追加する/ })).toHaveLength(0);
  });
});
