/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();

jest.mock('@/utils/access', () => ({ useAccess: () => ({ canEditDepartment: () => true }) }));
jest.mock('@/utils/authFetch', () => ({
  authFetchJson: (...args: unknown[]) => mockFetch(...args),
  AuthFetchError: class extends Error {},
}));

// jest.mock は import より後に評価されるため、モック登録後に読み込む
const DepartmentQuestionStepper = require('./QuestionStepper.dept').default as typeof import('./QuestionStepper.dept').default;

function questionFor(n: number) {
  return { step: { label: `L${n}`, question: `Q${n}テーマ`, reason: `理由${n}`, hint: `ヒント${n}` } };
}

describe('DepartmentQuestionStepper（6つの問い）', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (_url: string, opts: { json: { afterStepIndex: number } }) =>
      questionFor(opts.json.afterStepIndex + 2),
    );
  });

  it('6つのテーマを番号タブではなくテーマ名の一覧として表示し、初回だけ生成ボタンを出す', () => {
    render(<DepartmentQuestionStepper departmentName="営業部" />);
    expect(screen.getAllByText('未生成')).toHaveLength(6);
    expect(screen.getByText('このテーマを生成')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('空欄の回答でも次のテーマへ進み、次の問いは1回だけ自動で生成される', async () => {
    const onChange = jest.fn();
    render(<DepartmentQuestionStepper departmentName="営業部" onChange={onChange} />);

    fireEvent.click(screen.getByText('このテーマを生成'));
    await waitFor(() => expect(screen.getByText('Q1テーマ')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const next = screen.getByText('次のテーマへ') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);

    await waitFor(() => expect(screen.getByText('Q2テーマ')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondCall = mockFetch.mock.calls[1][1] as { json: { answersSoFar: unknown[]; afterStepIndex: number } };
    expect(secondCall.json.afterStepIndex).toBe(0);
    expect(secondCall.json.answersSoFar).toEqual([{ stepNumber: 1, answer: '' }]);
    expect(screen.queryByText('このテーマを生成')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ answers: expect.arrayContaining([expect.objectContaining({ stepNumber: 1, answer: '' })]) }),
    );
  });

  it('入力済みのテーマを開いても再生成のAPIは呼ばれず、回答欄に既存の回答が入る', async () => {
    const initialAnswers = [
      { stepNumber: 1 as const, label: 'L1', question: 'Q1テーマ', reason: '理由1', answer: '既存の回答', createdAt: '2026-11-01' },
    ];
    render(<DepartmentQuestionStepper departmentName="営業部" initialAnswers={initialAnswers} />);
    await waitFor(() => expect(screen.getByDisplayValue('既存の回答')).toBeTruthy());

    fireEvent.click(screen.getByText('Q2').closest('button') as HTMLButtonElement);
    fireEvent.click(screen.getByText('Q1テーマ').closest('button') as HTMLButtonElement);
    await waitFor(() => expect(screen.getByDisplayValue('既存の回答')).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('一覧は現在の問いだけを開き、ほかの問いの回答欄は出さない（開閉式）', async () => {
    const initialAnswers = [
      { stepNumber: 1 as const, label: 'L1', question: 'Q1テーマ', reason: '理由1', answer: 'A1', createdAt: '2026-11-01' },
    ];
    const { container } = render(<DepartmentQuestionStepper departmentName="営業部" initialAnswers={initialAnswers} />);
    const expanded = Array.from(container.querySelectorAll('button[aria-expanded="true"]'));
    expect(expanded).toHaveLength(1);
    expect(expanded[0].textContent).toContain('Q1テーマ');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });
  it('回答を編集したら未保存の表示が出て、テーマを移動せずに保存できる', async () => {
    const onChange = jest.fn();
    render(<DepartmentQuestionStepper departmentName="営業部" onChange={onChange} />);
    fireEvent.click(screen.getByText('このテーマを生成'));
    await waitFor(() => expect(screen.getByText('Q1テーマ')).toBeTruthy());

    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '保存する回答' } });
    expect(screen.getByText('未保存の変更があります')).toBeTruthy();

    fireEvent.click(screen.getByText('回答を保存'));
    await waitFor(() => expect(screen.queryByText('未保存の変更があります')).toBeNull());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentStep: 1,
        answers: [expect.objectContaining({ stepNumber: 1, answer: '保存する回答' })],
      }),
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});


describe('DepartmentQuestionStepper（再生成の前の保存）', () => {
  it('未保存の回答は、登録された関数で親へ渡され、2回目は変更がないので渡さない', async () => {
    const onChange = jest.fn();
    let flush: (() => void) | null = null;
    const onRegisterFlush = (fn: (() => void) | null) => { flush = fn; };
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => questionFor(1));
    render(<DepartmentQuestionStepper departmentName="営業部" onChange={onChange} onRegisterFlush={onRegisterFlush} />);
    fireEvent.click(screen.getByText('このテーマを生成'));
    await waitFor(() => expect(screen.getByText('Q1テーマ')).toBeTruthy());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '再生成の前の回答' } });
    act(() => { (flush as unknown as () => void)(); });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ answers: [expect.objectContaining({ stepNumber: 1, answer: '再生成の前の回答' })] }),
    );
    const calls = onChange.mock.calls.length;
    act(() => { (flush as unknown as () => void)(); });
    expect(onChange.mock.calls.length).toBe(calls);
  });
});
