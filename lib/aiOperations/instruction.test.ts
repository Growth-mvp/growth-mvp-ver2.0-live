import { appendCeoIntent, parseYenAmounts, resolveOperationInstruction, type OperationContext } from './instruction';

const BASE: OperationContext = {
  companyId: 'company-1',
  strategyId: 'strategy-1',
  ceoIntent: '原点は地域の暮らしを支えること。',
  revenueYenByYear: { 2025: 190_000_000 },
};

describe('parseYenAmounts', () => {
  it.each([
    ['1億6,000万円', 160_000_000],
    ['1億6000万円', 160_000_000],
    ['160百万円', 160_000_000],
    ['16000000円', 16_000_000],
    ['1,500千円', 1_500_000],
    ['１億６，０００万円', 160_000_000],
    ['1.6億円', 160_000_000],
  ])('「%s」を %d 円に換算する', (text, yen) => {
    expect(parseYenAmounts(text)).toEqual([yen]);
  });

  it('年度は金額として扱わない', () => {
    expect(parseYenAmounts('2025年度')).toEqual([]);
  });

  it('離れた位置の金額は別々に数える', () => {
    expect(parseYenAmounts('1億6,000万円、前年は1億7,000万円')).toEqual([160_000_000, 170_000_000]);
  });
});

describe('resolveOperationInstruction：STAGE2「経営者の思い」', () => {
  it('本人の言葉を、追加の対象として取り出す', () => {
    const result = resolveOperationInstruction('経営者の思いに、地域とのつながりを大切にしたいと追加して', BASE);
    expect(result).toEqual({
      kind: 'proposal',
      proposal: {
        kind: 'stage2.ceoIntent',
        pathname: '/stage2',
        companyId: 'company-1',
        strategyId: 'strategy-1',
        before: BASE.ceoIntent,
        addition: '地域とのつながりを大切にしたい',
      },
    });
  });

  it('すでに同じ文があれば入力案を作らない', () => {
    const ctx = { ...BASE, ceoIntent: '地域とのつながりを大切にしたい' };
    const result = resolveOperationInstruction('経営者の思いに、地域とのつながりを大切にしたいと追加して', ctx);
    expect(result?.kind).toBe('clarify');
  });

  it('追加する文がなければ質問する', () => {
    const result = resolveOperationInstruction('経営者の思いに追加して', BASE);
    expect(result?.kind).toBe('clarify');
  });

  it('質問は入力案にしない', () => {
    expect(resolveOperationInstruction('経営者の思いに何を追加すればいいですか', BASE)).toBeNull();
  });
});

describe('appendCeoIntent', () => {
  it('既存の文章を消さず、末尾に追記する', () => {
    expect(appendCeoIntent('A', 'B')).toBe('A\nB');
    expect(appendCeoIntent('A\n', 'B')).toBe('A\nB');
    expect(appendCeoIntent('', 'B')).toBe('B');
  });
});

describe('resolveOperationInstruction：STAGE1 全社売上高', () => {
  it('年度・全社・金額を特定し、登録済みの値と並べて入力案にする', () => {
    const result = resolveOperationInstruction('2025年度の全社売上高は1億6,000万円です', BASE);
    expect(result).toEqual({
      kind: 'proposal',
      proposal: {
        kind: 'stage1.revenue',
        pathname: '/stage1',
        companyId: 'company-1',
        strategyId: 'strategy-1',
        year: 2025,
        beforeYen: 190_000_000,
        afterYen: 160_000_000,
      },
    });
  });

  it('単位が百万円・円でも同じ金額に換算する', () => {
    const million = resolveOperationInstruction('2025年度の全社売上高は160百万円です', BASE);
    const yen = resolveOperationInstruction('2025年度の全社売上高は160000000円です', BASE);
    expect(million?.kind === 'proposal' && million.proposal.kind === 'stage1.revenue' && million.proposal.afterYen).toBe(160_000_000);
    expect(yen?.kind === 'proposal' && yen.proposal.kind === 'stage1.revenue' && yen.proposal.afterYen).toBe(160_000_000);
  });

  it('年度がなければ質問する', () => {
    expect(resolveOperationInstruction('全社の売上高は1億6,000万円です', BASE)?.kind).toBe('clarify');
  });

  it('全社か事業別かが分からなければ質問する', () => {
    expect(resolveOperationInstruction('2025年度の売上高は1億6,000万円です', BASE)?.kind).toBe('clarify');
  });

  it('金額が複数あれば入力案を作らない', () => {
    expect(resolveOperationInstruction('2025年度の全社売上高は1億6,000万円、前年は1億7,000万円です', BASE)?.kind).toBe('clarify');
  });

  it('登録済みと同じ金額なら入力案を作らない', () => {
    const ctx = { ...BASE, revenueYenByYear: { 2025: 160_000_000 } };
    expect(resolveOperationInstruction('2025年度の全社売上高は1億6,000万円です', ctx)?.kind).toBe('clarify');
  });

  it('質問や金額のない文は入力案にしない', () => {
    expect(resolveOperationInstruction('2025年度の全社売上高は1億6,000万円ですか', BASE)).toBeNull();
    expect(resolveOperationInstruction('売上を伸ばすにはどうすればいいですか', BASE)).toBeNull();
  });
});
