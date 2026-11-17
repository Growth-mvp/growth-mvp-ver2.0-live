/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FinanceActualItem } from '@/lib/stage5/financeActuals';
import { FinanceActualSection } from './FinanceActualSection';

const opexItem: FinanceActualItem = {
  itemKey: 'OPEX:ac16',
  kind: 'OPEX',
  label: '外注費（検証用）',
  planText: '一時支出 1,000,000円',
  periodText: '支出年月 2026-10',
  statusText: '営業利益に含まれない',
  recordable: true,
  unrecordableReason: null,
  actuals: [{ itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 900_000, note: '請求書', recordedAt: '2026-11-17T01:00:00.000Z', createdAt: '2026-11-17T01:00:00.000Z' }],
};

describe('FinanceActualSection', () => {
  it('計画額と登録済みの実績を表示する（計画は読み取り専用）', () => {
    render(<FinanceActualSection items={[opexItem]} onRecord={jest.fn()} />);
    expect(screen.getByText('計画：一時支出 1,000,000円')).toBeTruthy();
    expect(screen.getByRole('table', { name: '外注費（検証用）の月次実績' })).toBeTruthy();
    expect(screen.getByText('請求書')).toBeTruthy();
  });

  it('入力を検証し、正しい内容だけ記録を依頼する（0円も記録できる）', async () => {
    const onRecord = jest.fn(async () => ({ ok: true as const }));
    render(<FinanceActualSection items={[{ ...opexItem, actuals: [] }]} onRecord={onRecord} />);
    fireEvent.change(screen.getByLabelText('外注費（検証用）の対象年月'), { target: { value: '2026-11' } });
    fireEvent.change(screen.getByLabelText('外注費（検証用）の実績金額'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('実績金額を入力してください');
    expect(onRecord).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('外注費（検証用）の実績金額'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(onRecord).toHaveBeenCalledWith({ itemKey: 'OPEX:ac16', ym: '2026-11', amountYen: 0, note: undefined }),
    );
    expect(await screen.findByText('2026-11 の実績を保存しました')).toBeTruthy();
  });

  it('修正を押すと、その年月と金額を入力欄に入れる（別の行を作らない）', () => {
    render(<FinanceActualSection items={[opexItem]} onRecord={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '修正' }));
    expect((screen.getByLabelText('外注費（検証用）の対象年月') as HTMLInputElement).value).toBe('2026-10');
    expect((screen.getByLabelText('外注費（検証用）の実績金額') as HTMLInputElement).value).toBe('900000');
    expect((screen.getByLabelText('外注費（検証用）の根拠・補足') as HTMLInputElement).value).toBe('請求書');
  });

  it('保存に失敗したら、理由を表示し、成功とは表示しない', async () => {
    const onRecord = jest.fn(async () => ({ ok: false as const, error: '実績を保存できませんでした。もう一度お試しください。' }));
    render(<FinanceActualSection items={[{ ...opexItem, actuals: [] }]} onRecord={onRecord} />);
    fireEvent.change(screen.getByLabelText('外注費（検証用）の対象年月'), { target: { value: '2026-11' } });
    fireEvent.change(screen.getByLabelText('外注費（検証用）の実績金額'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('実績を保存できませんでした');
    expect(screen.queryByText('2026-11 の実績を保存しました')).toBeNull();
  });

  it('記録できない項目は、入力欄を出さず理由だけを表示する', () => {
    render(
      <FinanceActualSection
        items={[{ ...opexItem, itemKey: '', recordable: false, unrecordableReason: 'この明細には識別子（ID）がありません', actuals: [] }]}
        onRecord={jest.fn()}
      />,
    );
    expect(screen.getByRole('note').textContent).toContain('識別子（ID）がありません');
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  });

  it('財務効果がない案件では、案内だけを表示する', () => {
    render(<FinanceActualSection items={[]} onRecord={jest.fn()} />);
    expect(screen.getByText(/STAGE4で財務効果または追加費用（OPEX）を入力すると/)).toBeTruthy();
  });
});
