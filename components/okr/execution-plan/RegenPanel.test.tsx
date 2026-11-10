/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { PreviewRow } from '@/lib/stage4/planView/regenPreview';
import { RegenPanel, type RegenState } from './RegenPanel';

const rows: PreviewRow[] = [
  { itemId: 'action:1:title', label: '行動1', currentValue: '旧い案', newValue: '新しい案', status: 'AVAILABLE', reason: null },
  { itemId: 'risk:1:countermeasure', label: 'リスク1', currentValue: '利用者の修正', newValue: '新しい対策', status: 'MANUAL', reason: '利用者が修正した内容があるため、上書きしない' },
  { itemId: 'responsible', label: '責任者', currentValue: '担当A', newValue: '担当B', status: 'EXCLUDED', reason: '責任者は利用者が決めるため、AIの案では反映しない' },
  { itemId: 'claim:goal', label: '目標', currentValue: '同じ', newValue: '同じ', status: 'SAME', reason: null },
];

const ready = (selected: string[] = []): RegenState => ({ status: 'READY', rows, selected });

describe('RegenPanel（AIでもう一度作るの比較）', () => {
  it('変更のある項目だけを、現在の内容と新しい案で並べ、反映できるものにだけチェックを付ける', () => {
    render(<RegenPanel state={ready()} onToggle={() => {}} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('行動1')).toBeTruthy();
    expect(screen.getByText('旧い案')).toBeTruthy();
    expect(screen.getByText('新しい案')).toBeTruthy();
    expect(screen.getByText('修正あり（上書きしない）')).toBeTruthy();
    expect(screen.getByText('反映しない')).toBeTruthy();
    expect(screen.queryByText('目標')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText(/「草案として保存」を押すまでは/)).toBeTruthy();
  });

  it('反映は、項目を選ぶまで押せない。選ぶと、その項目を通知する', () => {
    const onToggle = jest.fn();
    const { rerender } = render(<RegenPanel state={ready()} onToggle={onToggle} onApply={() => {}} onCancel={() => {}} />);
    const apply = screen.getByRole('button', { name: '選んだ項目を反映する（未保存）' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '行動1を反映する' }));
    expect(onToggle).toHaveBeenCalledWith('action:1:title');
    rerender(<RegenPanel state={ready(['action:1:title'])} onToggle={onToggle} onApply={() => {}} onCancel={() => {}} />);
    expect((screen.getByRole('button', { name: '選んだ項目を反映する（未保存）' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('差分が無ければ、その旨を表示する', () => {
    render(
      <RegenPanel
        state={{ status: 'READY', rows: [rows[3]], selected: [] }}
        onToggle={() => {}}
        onApply={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('新しい案と現在の計画書に、違いはありません。')).toBeTruthy();
  });

  it('失敗したときは理由を示し、閉じられる。計画書には触れない', () => {
    const onCancel = jest.fn();
    render(<RegenPanel state={{ status: 'FAILED', message: '新しい案を作れませんでした。現在の計画書はそのままです。' }} onToggle={() => {}} onApply={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole('alert').textContent).toContain('現在の計画書はそのまま');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
