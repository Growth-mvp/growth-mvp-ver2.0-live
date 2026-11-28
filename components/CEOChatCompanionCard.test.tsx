/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import CEOChatCompanionCard from './CEOChatCompanionCard';
import type { CompanionAction } from '@/lib/companion/companionEngine';

const advice = (patch: Partial<CompanionAction> = {}): CompanionAction => ({
  kind: 'advice',
  key: 'RISK:co-a:st-a:2027-06-15',
  title: '経営点検（STAGE5・6）：AIの助言',
  message: '',
  href: '',
  linkLabel: '',
  canEdit: true,
  steps: [],
  body: '本文（相談用の全文）',
  status: 'ready',
  summary: 'お疲れさまです。御社の経営状況を確認しましたが、少し気になることがあります。',
  detail: '事実（保存済みデータの計算結果）\n- 2027年度：不足\n\n判断できなかった項目（理由別）\n- 実施事項の進捗：未登録',
  checkedLabel: '点検日時：2027年6月15日 9時05分（日本時間）',
  ...patch,
});

const noop = () => {};

describe('自律伴走の案内カード（経営点検の要約と詳細）', () => {
  it('初期表示は要約と点検日時を見せ、詳細は「経営点検の詳細を見る」の中にある', () => {
    render(
      <CEOChatCompanionCard action={advice()} onDismiss={noop} onAsk={noop} askDisabled={false} onVisible={noop} onRefresh={noop} />,
    );
    expect(screen.getByText(/お疲れさまです。御社の経営状況を確認しましたが/)).toBeTruthy();
    expect(screen.getByText('点検日時：2027年6月15日 9時05分（日本時間）')).toBeTruthy();
    const toggle = screen.getByText('経営点検の詳細を見る');
    expect(toggle.tagName).toBe('SUMMARY');
    const details = toggle.closest('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.textContent).toContain('- 2027年度：不足');
    expect(details!.textContent).toContain('判断できなかった項目（理由別）');
  });

  it('詳細を開くと、全文を読める（省略しない）', () => {
    render(<CEOChatCompanionCard action={advice()} onDismiss={noop} onAsk={noop} askDisabled={false} onVisible={noop} />);
    const toggle = screen.getByText('経営点検の詳細を見る');
    fireEvent.click(toggle);
    expect(toggle.closest('details')!.open).toBe(true);
  });

  it('相談・最新の点検を確認・閉じるは維持し、相談は全文を送る', () => {
    const onAsk = jest.fn();
    const onRefresh = jest.fn();
    const onDismiss = jest.fn();
    render(
      <CEOChatCompanionCard action={advice()} onDismiss={onDismiss} onAsk={onAsk} askDisabled={false} onVisible={noop} onRefresh={onRefresh} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'この助言について相談する' }));
    expect(onAsk.mock.calls[0][0]).toContain('本文（相談用の全文）');
    fireEvent.click(screen.getByRole('button', { name: '最新の点検を確認' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('要約が無い古い案内は、従来どおり本文を表示する（詳細は出さない）', () => {
    render(
      <CEOChatCompanionCard
        action={advice({ summary: undefined, detail: undefined, checkedLabel: undefined, body: '古い本文' })}
        onDismiss={noop}
        onAsk={noop}
        askDisabled={false}
        onVisible={noop}
      />,
    );
    expect(screen.getByText('古い本文')).toBeTruthy();
    expect(screen.queryByText('経営点検の詳細を見る')).toBeNull();
  });

  it('進行の案内は、従来どおり（詳細の開閉は出さない）', () => {
    render(
      <CEOChatCompanionCard
        action={{ kind: 'progress', key: 'ADD_ISSUE:co-a:st-a', title: '論点を1件作りましょう', message: '案内', href: '/stage1', linkLabel: 'STAGE1を開く', canEdit: true, steps: ['論点を追加する'] }}
        onDismiss={noop}
        onAsk={noop}
        askDisabled={false}
        onVisible={noop}
      />,
    );
    expect(screen.getByText('論点を1件作りましょう')).toBeTruthy();
    expect(screen.queryByText('経営点検の詳細を見る')).toBeNull();
  });
});
