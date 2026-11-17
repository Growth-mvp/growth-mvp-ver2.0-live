/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectLifecycleMenu, type PlanFacts } from './ProjectLifecycleMenu';

function renderMenu(facts: PlanFacts | Error, onChoose = jest.fn()) {
  const loadFacts = facts instanceof Error ? jest.fn(async () => Promise.reject(facts)) : jest.fn(async () => facts);
  render(<ProjectLifecycleMenu title="新規施策" loadFacts={loadFacts} onChoose={onChoose} />);
  fireEvent.click(screen.getByRole('button', { name: '新規施策の操作' }));
  return { onChoose };
}

describe('ProjectLifecycleMenu（プロジェクト選択欄の「…」メニュー）', () => {
  it('実行開始していない計画は「計画から外す」を出し、選ぶと EXCLUDE を渡す', async () => {
    const { onChoose } = renderMenu({ executing: false, started: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: '計画から外す' }));
    expect(onChoose).toHaveBeenCalledWith('EXCLUDE', { executing: false, started: false });
    expect(screen.queryByRole('menuitem', { name: 'プロジェクトを中止する' })).toBeNull();
  });

  it('実行を開始した計画は「プロジェクトを中止する」だけを出す', async () => {
    const { onChoose } = renderMenu({ executing: true, started: true });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'プロジェクトを中止する' }));
    expect(onChoose).toHaveBeenCalledWith('STOP', { executing: true, started: true });
    expect(screen.queryByRole('menuitem', { name: '計画から外す' })).toBeNull();
  });

  it('採用済み（未開始）の計画は外せないと説明し、外す操作は出さない', async () => {
    renderMenu({ executing: true, started: false });
    expect(await screen.findByText(/採用を取り消すと、計画から外せます/)).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '計画から外す' })).toBeNull();
  });

  it('計画の状態を確認できなければ、操作を出さずに知らせる', async () => {
    renderMenu(new Error('network'));
    await waitFor(() => expect(screen.getByText(/計画の状態を確認できませんでした/)).toBeTruthy());
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
