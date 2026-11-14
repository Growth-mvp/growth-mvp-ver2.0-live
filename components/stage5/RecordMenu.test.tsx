/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RecordMenu, type RecordMenuItem } from './RecordMenu';

describe('RecordMenu', () => {
  it('項目がなければ「…」も出さない', () => {
    const { container } = render(createElement(RecordMenu, { items: [] }));
    expect(container.innerHTML).toBe('');
  });

  it('「…」を開くと項目が出て、選ぶと処理を呼び、メニューを閉じる', () => {
    const onEdit = jest.fn();
    const items: RecordMenuItem[] = [
      { label: '編集', onSelect: onEdit },
      { label: '削除', danger: true, onSelect: jest.fn() },
    ];
    render(createElement(RecordMenu, { items }));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '記録の操作' }));
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('メニューの外を押すと閉じる', () => {
    render(createElement(RecordMenu, { items: [{ label: '削除', onSelect: jest.fn() }] }));
    fireEvent.click(screen.getByRole('button', { name: '記録の操作' }));
    expect(screen.getByRole('menu')).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('無効な項目は選べない', () => {
    const onDelete = jest.fn();
    render(createElement(RecordMenu, { items: [{ label: '削除', disabled: true, onSelect: onDelete }] }));
    fireEvent.click(screen.getByRole('button', { name: '記録の操作' }));
    const item = screen.getByRole('menuitem', { name: '削除' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
