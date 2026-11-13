/**
 * @jest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { useSetStartMode } from './startMode';

jest.doMock('next/navigation', () => ({ useSearchParams: () => null }));
jest.doMock('@/components/CeoDrawerCloseContext', () => ({ useCeoDrawerCloseButton: () => undefined }));
jest.doMock('./Stage3ReadPanel', () => ({
  __esModule: true,
  default: () => {
    const setStartMode = useSetStartMode();
    useEffect(() => {
      setStartMode?.(true);
    }, [setStartMode]);
    return createElement('div', null, '実行開始の表示');
  },
}));

const Stage4DocumentScreen = require('./Stage4DocumentScreen').default as (props: { top?: React.ReactNode }) => JSX.Element;

describe('STAGE4の文書画面：実行開始の表示の間は、親の見出し（反映候補・OKRの見出し）を出さない', () => {
  it('開始の表示の間は、親の見出しを隠し、開始の表示だけを出す', async () => {
    render(createElement(Stage4DocumentScreen, { top: createElement('h1', null, 'OKRの見出し') }));
    await act(async () => undefined);
    expect(screen.getByText('実行開始の表示')).not.toBeNull();
    expect(screen.queryByText('OKRの見出し')).toBeNull();
  });
});
