import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceEffect } from '@/types/strategy';
import { FinancialDialoguePanel } from './FinancialDialoguePanel';

const M = 1_000_000;

function html(effect: FinanceEffect | undefined, assumptions: Record<string, number | undefined> = {}) {
  return renderToStaticMarkup(
    <FinancialDialoguePanel
      role="REVENUE"
      assumptions={assumptions}
      calc={null}
      effect={effect}
      origin={undefined}
      disabled={false}
      notice={null}
      onEffectChange={() => {}}
      onCreateCandidate={() => {}}
      assumptionEditor={null}
      detailsSlot={null}
    />,
  );
}

describe('売上の質問：前提の計算式が無い施策（フィットネスなど）', () => {
  const direct: FinanceEffect = {
    kind: 'REVENUE_UP',
    method: 'DIRECT_AMOUNT',
    directAmountYen: 24 * M,
    amountBasis: 'ANNUAL',
    startYm: '2026-04',
    sourceNote: '会員数 300人 × 月会費 8,000円 × 12か月（架空・会員台帳）',
    source: 'USER_INPUT',
    confirmed: false,
  };

  it('計算式の無い見込みは、「対象顧客」の質問にせず、根拠を問う', () => {
    const out = html(direct, {});
    expect(out).toContain('この見込み金額（24百万円）の根拠は、会社の実績や確認できる数字で説明できますか？');
    expect(out).not.toContain('対象顧客—社');
  });

  it('登録済みの直接金額と計算式を、通常画面で示す', () => {
    const out = html(direct, {});
    expect(out).toContain('登録済みの見込み：24百万円');
    expect(out).toContain('直接入力：24,000,000円');
  });

  it('前提の数字がある施策は、従来どおり対象顧客数の質問になる', () => {
    const out = html({ ...direct, method: 'FUNNEL', meetingsPerPeriod: 30, winRatePct: 20, averageDealYen: 20 * M, source: 'AI_PROPOSED' }, { targetCustomers: 30 });
    expect(out).toContain('対象顧客30社という数字は');
  });
});
