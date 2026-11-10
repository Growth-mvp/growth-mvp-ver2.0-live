/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('Stage4FinanceConfirm（第5章の財務効果の確認）', () => {
  it('参考試算の数値から草案を表示し、確認項目が済むまでは確認ボタンを押せない', () => {
    render(<Stage4FinanceConfirm drafts={drafts()} saved={[]} overlapCount={0} writable onWrite={jest.fn()} />);
    expect(screen.getByLabelText('売上増加（参考試算の売上）の財務効果').textContent).toContain('10社 × 30% × 20百万円');
    expect(screen.getByLabelText('追加費用の財務効果').textContent).toContain('6百万円');
    const confirmButtons = screen.getAllByRole('button', { name: 'この内容を財務効果として確認' });
    confirmButtons.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
  });

  it('単位と開始年月を入力し、草案として保存すると、草案の内容と SAVE_DRAFT を渡す', async () => {
    const onWrite = jest.fn(async () => ({ ok: true as const, outcome: 'created', revision: 3 }));
    render(<Stage4FinanceConfirm drafts={drafts()} saved={[]} overlapCount={0} writable onWrite={onWrite} />);
    const card = screen.getByLabelText('追加費用の財務効果');
    fireEvent.change(card.querySelector('select')!, { target: { value: 'ANNUAL' } });
    fireEvent.click(card.querySelectorAll('button')[0]);
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const [candidate, action] = onWrite.mock.calls[0] as unknown as [any, string];
    expect(action).toBe('SAVE_DRAFT');
    expect(candidate).toMatchObject({ kind: 'COST_INCREASE', amountBasis: 'ANNUAL', directAmountYen: 6_000_000, confirmed: false });
    expect(await screen.findByText('草案として保存しました。')).toBeTruthy();
  });

  it('単位と年度がそろうと確認ボタンが有効になり、CONFIRM を渡す', async () => {
    const onWrite = jest.fn(async () => ({ ok: true as const, outcome: 'confirmed' }));
    const saved = [
      { ...drafts().find((d) => d.kind === 'COST_INCREASE')!.base, amountBasis: 'ANNUAL', startYm: '2026-04', endYm: '2027-03', confirmed: false },
    ] as any[];
    render(<Stage4FinanceConfirm drafts={drafts()} saved={saved} overlapCount={0} writable onWrite={onWrite} />);
    const card = screen.getByLabelText('追加費用の財務効果');
    fireEvent.change(card.querySelector('select')!, { target: { value: 'ANNUAL' } });
    const months = card.querySelectorAll('input[type="month"]');
    fireEvent.change(months[0], { target: { value: '2026-04' } });
    fireEvent.change(months[1], { target: { value: '2027-03' } });
    const confirm = card.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(onWrite).toHaveBeenCalledWith(expect.objectContaining({ kind: 'COST_INCREASE' }), 'CONFIRM'));
  });

  it('AIの仮説から作った売上は、商談数の扱いと追加効果の確認が済むまで確認を保留する', () => {
    const est = estimateProjectImpact(
      { ...project, impactAssumptions: undefined, impactRationale: '' },
      { edits: { 'impact:startYear': 2027, 'impact:endYear': 2028 }, hypothesis: { customers: 10, rate: 30, deal: 20 } },
    );
    const aiDrafts = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' });
    render(<Stage4FinanceConfirm drafts={aiDrafts} saved={[]} overlapCount={0} writable onWrite={jest.fn()} />);
    const card = screen.getByLabelText('売上増加（参考試算の売上）の財務効果');
    fireEvent.change(card.querySelector('select')!, { target: { value: 'ANNUAL' } });
    expect(card.textContent).toContain('商談数として扱ってよいかが未確認');
    expect(card.textContent).toContain('既存の売上に対する追加効果かが未確認');
    expect((card.querySelectorAll('button')[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('確認済みの効果は、STAGE6の試算に入る旨を表示し、変更の操作を出さない', () => {
    const saved = [{ ...drafts().find((d) => d.kind === 'COST_INCREASE')!.base, amountBasis: 'ANNUAL', confirmed: true, confirmedAt: '2026-11-10T00:00:00.000Z' }] as any[];
    render(<Stage4FinanceConfirm drafts={drafts()} saved={saved} overlapCount={0} writable onWrite={jest.fn()} />);
    const card = screen.getByLabelText('追加費用の財務効果');
    expect(card.textContent).toContain('確認済み（STAGE6の試算に入ります）');
    card.querySelectorAll('button').forEach((b) => expect(b.disabled).toBe(true));
  });

  it('書き込めない状態（採用・開始済み等）では、すべての操作を無効にし、理由を出す', () => {
    render(
      <Stage4FinanceConfirm
        drafts={drafts()}
        saved={[]}
        overlapCount={0}
        writable={false}
        reasonNotWritable="採用・開始済みの計画書では、財務効果の確認を変更できません。"
        onWrite={jest.fn()}
      />,
    );
    expect(screen.getByText('採用・開始済みの計画書では、財務効果の確認を変更できません。')).toBeTruthy();
    screen.getAllByRole('button').forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
  });
  it('保存済みの草案を再読み込みしたら、保存した内容で入力欄が戻り、同じ内容で確認できる', () => {
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
    render(<Stage4FinanceConfirm drafts={[revenue]} saved={[savedRevenue]} overlapCount={0} writable onWrite={jest.fn()} />);
    const card = screen.getByLabelText('売上増加（参考試算の売上）の財務効果');
    expect((card.querySelector('select') as HTMLSelectElement).value).toBe('ANNUAL');
    expect((screen.getByLabelText('売上増加（参考試算の売上）の開始年月') as HTMLInputElement).value).toBe('2026-12');
    expect((screen.getByLabelText('売上増加（参考試算の売上）の営業利益の増分') as HTMLInputElement).value).toBe('9');
    expect((screen.getByLabelText('売上増加（参考試算の売上）の売上の区分') as HTMLSelectElement).value).toBe('PAID_DEVELOPMENT');
  });
});
