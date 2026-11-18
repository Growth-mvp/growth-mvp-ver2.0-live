/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KRStructured } from '@/types/strategy';
import type { FinanceActualItem } from '@/lib/stage5/financeActuals';
import { ActualRegistrationSection, planRegistration, prefillFor } from './ActualRegistrationSection';

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

const kr = (id: string, label: string, actual?: KRStructured['actual']): KRStructured =>
  ({ id, label, target: 95, unit: '%', due: '2027-06', ...(actual ? { actual } : {}) }) as unknown as KRStructured;

const NOW = '2026-11-17T00:00:00.000Z';

describe('実績の登録（ActualRegistrationSection）', () => {
  it('対象年月を選ぶまでは、登録済みの実績や入力欄の値を出さない。計画は読み取り専用', () => {
    render(<ActualRegistrationSection items={[opexItem]} krs={[]} onRecordFinance={jest.fn()} onRecordKr={jest.fn()} />);
    expect(screen.getByText(/計画：一時支出 1,000,000円/)).toBeTruthy();
    expect((screen.getByLabelText('外注費（検証用）の実績金額') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(/登録済み：900,000円/)).toBeNull();
  });

  it('対象年月を選ぶと、その年月の登録済みの実績を入力欄に入れる（修正できる）', () => {
    render(<ActualRegistrationSection items={[opexItem]} krs={[]} onRecordFinance={jest.fn()} onRecordKr={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('対象年月'), { target: { value: '2026-10' } });
    expect((screen.getByLabelText('外注費（検証用）の実績金額') as HTMLInputElement).value).toBe('900000');
    expect(screen.getByText('登録済み：900,000円')).toBeTruthy();
  });

  it('空欄は保存せず、0 は 0円として保存する（0円と未入力を区別する）', async () => {
    const onRecordFinance = jest.fn(async () => ({ ok: true as const }));
    render(<ActualRegistrationSection items={[{ ...opexItem, actuals: [] }]} krs={[]} onRecordFinance={onRecordFinance} onRecordKr={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('対象年月'), { target: { value: '2026-11' } });
    fireEvent.click(screen.getByRole('button', { name: '実績を保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('保存する実績を入力してください');
    expect(onRecordFinance).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('外注費（検証用）の実績金額'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '実績を保存' }));
    await waitFor(() => expect(onRecordFinance).toHaveBeenCalledWith({ itemKey: 'OPEX:ac16', ym: '2026-11', amountYen: 0 }));
    expect((await screen.findByRole('status')).textContent).toContain('1件保存しました');
  });

  it('KRの基準日は既存の日付を保つ（同じ月の日単位の記録）', () => {
    render(
      <ActualRegistrationSection
        items={[]}
        krs={[kr('kr-1', '継続率', { value: 88, asOf: '2026-10-15', recordedAt: NOW })]}
        onRecordFinance={jest.fn()}
        onRecordKr={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('対象年月'), { target: { value: '2026-10' } });
    expect((screen.getByLabelText('継続率の基準日') as HTMLInputElement).value).toBe('2026-10-15');
    expect((screen.getByLabelText('継続率の実績値（%）') as HTMLInputElement).value).toBe('88');
  });

  it('別の月の実績は入力欄に入れず、その旨を示す', () => {
    render(
      <ActualRegistrationSection
        items={[]}
        krs={[kr('kr-1', '継続率', { value: 88, asOf: '2026-09', recordedAt: NOW })]}
        onRecordFinance={jest.fn()}
        onRecordKr={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('対象年月'), { target: { value: '2026-10' } });
    expect((screen.getByLabelText('継続率の実績値（%）') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/別の基準日の実績：88%（基準日 2026-09）/)).toBeTruthy();
  });

  it('一部だけ保存できたら、すべて保存済みとは表示せず、失敗した項目の入力を残す', async () => {
    const onRecordFinance = jest.fn(async () => ({ ok: true as const }));
    const onRecordKr = jest.fn(async () => ({ ok: false as const, error: '保存に失敗しました。もう一度お試しください。' }));
    render(
      <ActualRegistrationSection
        items={[{ ...opexItem, actuals: [] }]}
        krs={[kr('kr-1', '継続率')]}
        onRecordFinance={onRecordFinance}
        onRecordKr={onRecordKr}
      />,
    );
    fireEvent.change(screen.getByLabelText('対象年月'), { target: { value: '2026-11' } });
    fireEvent.change(screen.getByLabelText('外注費（検証用）の実績金額'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('継続率の実績値（%）'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '実績を保存' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('一部だけ保存されました');
    expect(alert.textContent).toContain('保存できませんでした：継続率');
    expect(alert.textContent).not.toContain('保存しました');
    expect((screen.getByLabelText('継続率の実績値（%）') as HTMLInputElement).value).toBe('90');
    expect((screen.getByLabelText('外注費（検証用）の実績金額') as HTMLInputElement).value).toBe('');
  });

  it('記録できない項目は入力欄を出さず、理由だけを表示する', () => {
    render(
      <ActualRegistrationSection
        items={[{ ...opexItem, itemKey: '', recordable: false, unrecordableReason: 'この明細には識別子（ID）がありません', actuals: [] }]}
        krs={[]}
        onRecordFinance={jest.fn()}
        onRecordKr={jest.fn()}
      />,
    );
    expect(screen.getByRole('note').textContent).toContain('識別子（ID）がありません');
    expect(screen.queryByLabelText('外注費（検証用）の実績金額')).toBeNull();
  });

  it('施策が選ばれていないときは、登録できないと案内する', () => {
    render(<ActualRegistrationSection items={[]} krs={undefined} onRecordFinance={jest.fn()} onRecordKr={jest.fn()} />);
    expect(screen.getByText('施策を特定できないため、実績を登録できません。')).toBeTruthy();
  });
});

describe('planRegistration（保存の前の検証）', () => {
  const draft = (over: Partial<Parameters<typeof planRegistration>[0]> = {}) => ({
    ym: '2026-11',
    finance: { 'OPEX:ac16': '' },
    kr: {},
    note: '',
    ...over,
  });

  it('対象年月がなければ保存しない', () => {
    expect(planRegistration(draft({ ym: '' }), [opexItem], [], NOW)).toEqual({ ok: false, error: '対象年月を選んでください。' });
  });

  it('不正な入力が1つでもあれば、何も保存しない（全体を止める）', () => {
    const r = planRegistration(draft({ finance: { 'OPEX:ac16': '1,000' }, kr: { 'kr-1': { value: 'abc', asOf: '2026-11' } } }), [opexItem], [kr('kr-1', '継続率')], NOW);
    expect(r.ok).toBe(false);
  });

  it('入力のある項目だけを、財務・KRの順に並べる。識別子のないKRは対象外', () => {
    const r = planRegistration(
      draft({ finance: { 'OPEX:ac16': '50,000' }, kr: { 'kr-1': { value: '91', asOf: '2026-11' }, '': { value: '5', asOf: '2026-11' } }, note: '請求書' }),
      [opexItem],
      [kr('kr-1', '継続率'), { ...kr('', '無印'), id: '' } as KRStructured],
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps.map((s) => s.kind)).toEqual(['FINANCE', 'KR']);
    expect(r.steps[0]).toMatchObject({ args: { itemKey: 'OPEX:ac16', ym: '2026-11', amountYen: 50000, note: '請求書' } });
  });

  it('登録済みの実績を読み込んだだけ（変更なし）では保存しない', () => {
    const r = planRegistration(
      { ym: '2026-10', finance: { 'OPEX:ac16': '900000' }, kr: {}, note: '' },
      [opexItem],
      [],
      NOW,
    );
    expect(r).toEqual({ ok: false, error: '変更された実績がありません。新しい値を入力してください。' });
  });

  it('変更した項目だけを保存し、変更していない実績は保存しない', () => {
    const r = planRegistration(
      { ym: '2026-10', finance: { 'OPEX:ac16': '800000' }, kr: { 'kr-1': { value: '88', asOf: '2026-10-15' } }, note: '' },
      [opexItem],
      [kr('kr-1', '継続率', { value: 88, asOf: '2026-10-15', recordedAt: NOW })],
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps.map((s) => s.key)).toEqual(['OPEX:ac16']);
  });

  it('共通の根拠・補足が空欄なら、既存の項目別の補足を消さずに引き継ぐ', () => {
    const r = planRegistration(
      { ym: '2026-10', finance: { 'OPEX:ac16': '800000' }, kr: {}, note: '' },
      [opexItem],
      [],
      NOW,
    );
    expect(r.ok && r.steps[0]).toMatchObject({ args: { amountYen: 800_000, note: '請求書' } });
  });

  it('共通の根拠・補足を入れたときは、変更した項目にそれを使う', () => {
    const r = planRegistration(
      { ym: '2026-10', finance: { 'OPEX:ac16': '800000' }, kr: {}, note: '見積書' },
      [opexItem],
      [],
      NOW,
    );
    expect(r.ok && r.steps[0]).toMatchObject({ args: { amountYen: 800_000, note: '見積書' } });
  });

  it('0への変更は保存する（空欄とは区別する）。空欄への変更は保存しない', () => {
    const zero = planRegistration({ ym: '2026-10', finance: { 'OPEX:ac16': '0' }, kr: {}, note: '' }, [opexItem], [], NOW);
    expect(zero.ok && zero.steps[0]).toMatchObject({ args: { amountYen: 0 } });
    const blank = planRegistration({ ym: '2026-10', finance: { 'OPEX:ac16': '' }, kr: {}, note: '' }, [opexItem], [], NOW);
    expect(blank).toEqual({ ok: false, error: '保存する実績を入力してください。空欄の項目は保存されません。' });
  });

  it('KRは、同じ月の値と基準日が変わったときだけ保存し、既存の補足を残す', () => {
    const current = { value: 88, asOf: '2026-10-15', recordedAt: NOW, note: '月次締め' };
    const same = planRegistration({ ym: '2026-10', finance: {}, kr: { 'kr-1': { value: '88', asOf: '2026-10-15' } }, note: '' }, [], [kr('kr-1', '継続率', current)], NOW);
    expect(same).toEqual({ ok: false, error: '変更された実績がありません。新しい値を入力してください。' });
    const changed = planRegistration({ ym: '2026-10', finance: {}, kr: { 'kr-1': { value: '90', asOf: '2026-10-15' } }, note: '' }, [], [kr('kr-1', '継続率', current)], NOW);
    expect(changed.ok && changed.steps[0]).toMatchObject({ actual: { value: 90, asOf: '2026-10-15', note: '月次締め' } });
  });

  it('既存の実績の年月に合わせた入力欄は、基準日つきの実績を引き継ぐ', () => {
    const p = prefillFor('2026-10', [opexItem], [kr('kr-1', '継続率', { value: 88, asOf: '2026-10-15', recordedAt: NOW })]);
    expect(p.finance['OPEX:ac16']).toBe('900000');
    expect(p.kr['kr-1']).toEqual({ value: '88', asOf: '2026-10-15' });
  });

  it('中止した施策の上限より後の月は保存しない。上限の月（中止月）までは保存する', () => {
    const after = planRegistration(draft({ ym: '2026-11', finance: { 'OPEX:ac16': '1' } }), [{ ...opexItem, actuals: [] }], [], NOW, '2026-10');
    expect(after).toEqual({ ok: false, error: '中止した月（2026-10）より後の実績は登録できません。' });
    const upTo = planRegistration({ ym: '2026-10', finance: { 'OPEX:ac16': '800000' }, kr: {}, note: '' }, [opexItem], [], NOW, '2026-10');
    expect(upTo.ok).toBe(true);
  });

  it('中止後の上限は、KRの基準日の月にも効く（基準日が上限より後なら保存しない）', () => {
    const r = planRegistration(
      { ym: '2026-10', finance: {}, kr: { 'kr-1': { value: '90', asOf: '2026-11-03' } }, note: '' },
      [],
      [kr('kr-1', '継続率')],
      NOW,
      '2026-10',
    );
    expect(r).toEqual({ ok: false, error: '継続率：中止した月（2026-10）より後の実績は登録できません。' });
  });
});

describe('中止した施策の実績（登録できる月の上限）', () => {
  it('中止月より後の月は選べず、中止月は選べる。入力欄の max も中止月になる', () => {
    render(<ActualRegistrationSection items={[{ ...opexItem, actuals: [] }]} krs={[]} maxYm="2026-10" onRecordFinance={jest.fn()} onRecordKr={jest.fn()} />);
    const month = screen.getByLabelText('対象年月') as HTMLInputElement;
    expect(month.max).toBe('2026-10');

    fireEvent.change(month, { target: { value: '2026-11' } });
    expect(month.value).toBe('');
    expect((screen.getByRole('alert') as HTMLElement).textContent).toContain('中止した月（2026-10）より後の実績は登録できません。');
    expect((screen.getByLabelText('外注費（検証用）の実績金額') as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(month, { target: { value: '2026-10' } });
    expect(month.value).toBe('2026-10');
    expect((screen.getByLabelText('外注費（検証用）の実績金額') as HTMLInputElement).disabled).toBe(false);
  });

  it('中止していない施策は、月に上限を設けない', () => {
    render(<ActualRegistrationSection items={[{ ...opexItem, actuals: [] }]} krs={[]} onRecordFinance={jest.fn()} onRecordKr={jest.fn()} />);
    const month = screen.getByLabelText('対象年月') as HTMLInputElement;
    expect(month.hasAttribute('max')).toBe(false);
    fireEvent.change(month, { target: { value: '2027-03' } });
    expect(month.value).toBe('2027-03');
  });

  it('KRの基準日が中止月より後なら、保存せず入力を残す（onRecordKr は呼ばない）', async () => {
    const onRecordKr = jest.fn(async () => ({ ok: true as const }));
    render(<ActualRegistrationSection items={[]} krs={[kr('kr-1', '継続率')]} maxYm="2026-10" onRecordFinance={jest.fn()} onRecordKr={onRecordKr} />);
    fireEvent.change(screen.getByLabelText('対象年月'), { target: { value: '2026-10' } });
    fireEvent.change(screen.getByLabelText('継続率の実績値（%）'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('継続率の基準日'), { target: { value: '2026-11-03' } });
    fireEvent.click(screen.getByRole('button', { name: '実績を保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('継続率：中止した月（2026-10）より後の実績は登録できません。');
    expect(onRecordKr).not.toHaveBeenCalled();
  });
});
