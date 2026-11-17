/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ActionProgressRecord } from '@/lib/stage5/actionProgress';
import type { StartedPlanAction } from '@/lib/stage5/startedPlans';

const writeMock = jest.fn();
jest.mock('@/lib/stage5/actionProgressStore', () => ({
  writeActionProgress: (args: unknown) => writeMock(args),
}));

const { ActionProgressEditor } = require('./ActionProgressEditor') as typeof import('./ActionProgressEditor');

const action = (no: number, key: string, title: string): StartedPlanAction => ({
  no,
  actionKey: key,
  title,
  content: '',
  due: '2026-12',
  owner: '佐藤',
  deliverable: null,
  exitCondition: null,
});

const record = (over: Partial<ActionProgressRecord> = {}): ActionProgressRecord => ({
  status: 'NOT_STARTED',
  result: '',
  issue: '',
  nextAction: '',
  krIds: [],
  updatedAt: '2026-11-01T00:00:00.000Z',
  updatedBy: 'u',
  ...over,
});

const baseProps = (over: Record<string, unknown> = {}) => ({
  companyId: 'c',
  strategyId: 's',
  projectId: 'p',
  userId: 'u',
  allowedKeys: ['k1', 'k2'],
  actions: [action(1, 'k1', '更新案内の送付'), action(2, 'k2', 'KPIの確認')],
  progress: {} as Record<string, ActionProgressRecord>,
  krs: [],
  ...over,
});

describe('ActionProgressEditor（実施事項の進捗）', () => {
  beforeEach(() => writeMock.mockReset());

  it('変更がなければ保存できず、変更すると未保存の件数を示す', () => {
    render(<ActionProgressEditor {...baseProps()} />);
    expect((screen.getByRole('button', { name: '進捗を保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('1. の進捗メモ'), { target: { value: '案内文を送った' } });
    expect(screen.getByText('未保存の変更が1件あります')).toBeTruthy();
    expect((screen.getByRole('button', { name: '進捗を保存' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('変更した実施事項だけを、進捗と進捗メモだけで1回の保存にまとめる（課題・次の行動は送らない）', async () => {
    writeMock.mockResolvedValue({ ok: true, changed: true });
    render(<ActionProgressEditor {...baseProps({ progress: { k1: record({ issue: '旧課題', nextAction: '旧次' }) } })} />);
    fireEvent.change(screen.getByLabelText('1. の進捗メモ'), { target: { value: '案内文を送った' } });
    fireEvent.change(screen.getByLabelText('1. の進捗'), { target: { value: 'IN_PROGRESS' } });
    fireEvent.click(screen.getByRole('button', { name: '進捗を保存' }));
    await waitFor(() => expect(screen.getByText('1件の進捗を保存しました。')).toBeTruthy());
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock.mock.calls[0][0]).toMatchObject({ actionKey: 'k1', patch: { status: 'IN_PROGRESS', result: '案内文を送った' } });
    expect(writeMock.mock.calls[0][0].patch).not.toHaveProperty('issue');
    expect(writeMock.mock.calls[0][0].patch).not.toHaveProperty('nextAction');
  });

  it('以前の課題・次の行動は、保存したまま読み取りで表示する', () => {
    render(<ActionProgressEditor {...baseProps({ progress: { k1: record({ issue: '旧課題', nextAction: '旧次' }) } })} />);
    expect(screen.getByText('課題：旧課題')).toBeTruthy();
    expect(screen.getByText('次の行動（旧項目）：旧次')).toBeTruthy();
  });

  it('関連KRの選択は表示しない', () => {
    render(
      <ActionProgressEditor
        {...baseProps({ krs: [{ id: 'kr-1', label: '継続率', target: 95, unit: '%', due: null, actual: null, asOf: null }] })}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('関連KRを選ぶ')).toBeNull();
  });

  it('一部だけ保存できたら、保存できた件と保存できなかった件を分けて示し、失敗した入力を残す', async () => {
    writeMock.mockResolvedValueOnce({ ok: true, changed: true }).mockResolvedValueOnce({ ok: false, message: '進捗を保存できませんでした。もう一度お試しください。' });
    render(<ActionProgressEditor {...baseProps()} />);
    fireEvent.change(screen.getByLabelText('1. の進捗メモ'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('2. の進捗メモ'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: '進捗を保存' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1件を保存し、1件は保存できませんでした（2. KPIの確認）');
    expect(alert.textContent).not.toContain('進捗を保存しました');
    expect((screen.getByLabelText('2. の進捗メモ') as HTMLTextAreaElement).value).toBe('B');
  });
});
