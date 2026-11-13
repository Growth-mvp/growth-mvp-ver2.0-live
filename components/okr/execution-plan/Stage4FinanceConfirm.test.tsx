/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { estimateProjectImpact } from '@/lib/stage4/planView/impactEstimate';
import { buildFinanceEffectDrafts } from '@/lib/stage4/planView/financeBridge';
import { Stage4FinanceConfirm } from './Stage4FinanceConfirm';

const project = {
  id: 'p-jnc-renewal',
  role: 'REVENUE',
  impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20 },
  impactRationale: '追加費用6百万円を見込む',
};

function drafts() {
  const est = estimateProjectImpact(project, { edits: { 'impact:startYear': 2027, 'impact:endYear': 2028 } });
  return buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' });
}

function renderConfirm(over: Partial<React.ComponentProps<typeof Stage4FinanceConfirm>> = {}) {
  const onAnswer = jest.fn();
  render(
    <Stage4FinanceConfirm drafts={drafts()} saved={[]} overlapCount={0} writable answers={{}} onAnswer={onAnswer} {...over} />,
  );
  return { onAnswer };
}

describe('Stage4FinanceConfirm（財務効果の入力。保存は計画の保存で一括）', () => {
  it('参考試算の数値から案を表示し、個別の保存・確認ボタンと2つのチェックボックスは出さない', () => {
    renderConfirm();
    expect(screen.getByLabelText('売上増加（参考試算の売上）の財務効果').textContent).toContain('10社 × 30% × 20百万円');
    expect(screen.getByLabelText('追加費用の財務効果').textContent).toContain('6百万円');
    expect(screen.queryByRole('button', { name: 'この内容を財務効果として確認' })).toBeNull();
    expect(screen.queryByRole('button', { name: '草案として保存' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('金額の単位は通貨だけを示し、発生頻度を別の項目として選べる', () => {
    const { onAnswer } = renderConfirm();
    const card = screen.getByLabelText('追加費用の財務効果');
    expect(card.textContent).toContain('金額の単位：円');
    fireEvent.change(screen.getByLabelText('追加費用の発生頻度'), { target: { value: 'ANNUAL' } });
    expect(onAnswer).toHaveBeenCalledWith('COST_INCREASE', expect.objectContaining({ amountBasis: 'ANNUAL' }));
  });

  it('一回限りの回答があると、終了年月の入力は無効になる', () => {
    renderConfirm({ answers: { COST_INCREASE: { amountBasis: 'TOTAL' } } });
    expect((screen.getByLabelText('追加費用の終了年月') as HTMLInputElement).disabled).toBe(true);
  });

  it('入力中の回答は、保存済みの内容より優先して表示する', () => {
    renderConfirm({ answers: { COST_INCREASE: { amountBasis: 'MONTHLY', startYm: '2027-04' } } });
    expect((screen.getByLabelText('追加費用の発生頻度') as HTMLSelectElement).value).toBe('MONTHLY');
    expect((screen.getByLabelText('追加費用の開始年月') as HTMLInputElement).value).toBe('2027-04');
  });

  it('AIの仮説から作った売上は、確認項目が済むまで未確認の項目として示す', () => {
    const est = estimateProjectImpact(
      { ...project, impactAssumptions: undefined, impactRationale: '' },
      { edits: { 'impact:startYear': 2027, 'impact:endYear': 2028 }, hypothesis: { customers: 10, rate: 30, deal: 20 } },
    );
    const aiDrafts = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' });
    renderConfirm({ drafts: aiDrafts, answers: { REVENUE_UP: { amountBasis: 'ANNUAL', startYm: '2027-04', endYm: '2028-03', revenueKind: 'PAID_DEVELOPMENT' } } });
    const card = screen.getByLabelText('売上増加（参考試算の売上）の財務効果');
    expect(card.textContent).toContain('商談数として扱ってよいかが未確認');
    expect(card.textContent).toContain('既存の売上に対する追加効果かが未確認');
  });

  it('確認済みの効果は、STAGE6の試算に入る旨を表示し、入力を変えられない', () => {
    const saved = [{ ...drafts().find((d) => d.kind === 'COST_INCREASE')!.base, amountBasis: 'ANNUAL', confirmed: true, confirmedAt: '2026-11-10T00:00:00.000Z' }] as any[];
    renderConfirm({ saved });
    const card = screen.getByLabelText('追加費用の財務効果');
    expect(card.textContent).toContain('確認済み（STAGE6の試算に入ります）');
    card.querySelectorAll('select, input').forEach((el) => expect((el as HTMLInputElement).disabled).toBe(true));
  });

  it('書き込めない状態では入力を無効にし、理由を出す', () => {
    renderConfirm({ writable: false, reasonNotWritable: '計画書を読み込んでいます。' });
    expect(screen.getByText('計画書を読み込んでいます。')).toBeTruthy();
    screen.getAllByRole('combobox').forEach((el) => expect((el as HTMLSelectElement).disabled).toBe(true));
  });

  it('保存済みの草案を再読み込みしたら、保存した内容で入力欄が戻る', () => {
    const revenue = drafts().find((d) => d.kind === 'REVENUE_UP')!;
    const savedRevenue = {
      ...revenue.base,
      amountBasis: 'ANNUAL',
      startYm: '2026-12',
      endYm: '2027-05',
      isIncremental: true,
      operatingIncomeEffectYen: 9_000_000,
      opIncomeIncludesAddCost: true,
      revenueKind: 'PAID_DEVELOPMENT',
      confirmed: false,
    } as any;
    render(<Stage4FinanceConfirm drafts={[revenue]} saved={[savedRevenue]} overlapCount={0} writable answers={{}} onAnswer={jest.fn()} />);
    expect((screen.getByLabelText('売上増加（参考試算の売上）の発生頻度') as HTMLSelectElement).value).toBe('ANNUAL');
    expect((screen.getByLabelText('売上増加（参考試算の売上）の開始年月') as HTMLInputElement).value).toBe('2026-12');
    expect((screen.getByLabelText('売上増加（参考試算の売上）の営業利益の増分') as HTMLInputElement).value).toBe('9');
    expect((screen.getByLabelText('売上増加（参考試算の売上）の売上の区分') as HTMLSelectElement).value).toBe('PAID_DEVELOPMENT');
  });
});
