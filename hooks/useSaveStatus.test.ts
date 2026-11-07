/**
 * @jest-environment jsdom
 */
/* 保存拒否時に、サイドバーへ案内文を出すことを検証する（ストアは状態だけを差し替える）。 */

import { renderHook } from '@testing-library/react';
import { REVISION_UNKNOWN_SAVE_MESSAGE } from '@/lib/strategy/revisionUnknown';

const mockState: Record<string, unknown> = {};

jest.mock('@/store/strategyStore', () => ({
  useStrategyStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockState),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useSaveStatus } = require('./useSaveStatus') as typeof import('./useSaveStatus');

function setState(next: Record<string, unknown>) {
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, { boot: { isSaving: false }, dirty: false, lastSavedAt: 0 }, next);
}

describe('サイドバーの保存状態（保存拒否時の案内）', () => {
  it('REVISION_UNKNOWN の保存拒否は、保存されなかったことと未保存内容の注意を案内文として出す', () => {
    setState({ saveError: REVISION_UNKNOWN_SAVE_MESSAGE });
    const { result } = renderHook(() => useSaveStatus());

    expect(result.current.status).toBe('error');
    expect(result.current.message).toBe('保存に失敗');
    expect(result.current.helpText).toBe(REVISION_UNKNOWN_SAVE_MESSAGE);
    expect(result.current.helpText).toContain('保存できませんでした');
    expect(result.current.helpText).toContain('再読み込みすると失われる可能性');
  });

  it('それ以外の保存失敗は、従来どおり「再試行してください」を出す', () => {
    setState({ saveError: '保存に失敗しました: network down' });
    const { result } = renderHook(() => useSaveStatus());

    expect(result.current.status).toBe('error');
    expect(result.current.helpText).toBe('再試行してください');
  });

  it('正常時（エラーなし）は、案内文もエラー表示も出さない', () => {
    setState({ saveError: undefined, dirty: false });
    const { result } = renderHook(() => useSaveStatus());

    expect(result.current.status).toBe('saved');
    expect(result.current.helpText).not.toContain('保存できませんでした');
  });
});
