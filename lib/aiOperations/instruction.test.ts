import { appendCeoIntent, contextDepartments, issueProposalOf, parseYenAmounts, resolveOperationInstruction, stage3AnswerOf, type OperationContext } from './instruction';

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

describe('resolveOperationInstruction：STAGE3 6つの問い', () => {
  const STAGE3_CTX: OperationContext = {
    ...BASE,
    departments: [
      {
        name: '宅配事業',
        steps: [
          { stepNumber: 1, question: '地域の配送需要はどこにあるか', answer: '' },
          { stepNumber: 2, question: '競合と比べて何で選ばれるか', answer: '既存' },
          { stepNumber: 3, question: '採算をどう確保するか', answer: '' },
        ],
      },
      { name: '新聞販売', steps: [{ stepNumber: 1, question: '購読者をどう維持するか', answer: '' }] },
    ],
  };

  it('番号を指定した入力は、その問いの入力案にする', () => {
    const result = resolveOperationInstruction('宅配事業の6つの問いの1番目に、地域の配送需要を取り込むと入力して', STAGE3_CTX);
    expect(result).toEqual({
      kind: 'proposal',
      proposal: expect.objectContaining({
        kind: 'stage3.question',
        pathname: '/cascade',
        departmentName: '宅配事業',
        stepNumber: 1,
        answer: '地域の配送需要を取り込む',
        before: '',
      }),
    });
  });

  it('番号がなければ、内容に合う問いを候補にする', () => {
    const result = resolveOperationInstruction('宅配事業の6問に、採算を重視して確保すると入力して', STAGE3_CTX);
    expect(result).toEqual({
      kind: 'proposal',
      proposal: expect.objectContaining({ kind: 'stage3.question', stepNumber: 3, answer: '採算を重視して確保する' }),
    });
  });

  it('内容に合う問いがなければ番号を質問する', () => {
    expect(resolveOperationInstruction('宅配事業の6問に、まったく別の話を入力して', STAGE3_CTX)?.kind).toBe('clarify');
  });

  it('問いの質問文がまだ無い番号は、表示してから指示するよう案内する', () => {
    const result = resolveOperationInstruction('宅配事業の6つの問いの5番目に、人材を増やすと入力して', STAGE3_CTX);
    expect(result).toEqual({ kind: 'clarify', message: expect.stringContaining('5番目の問いがまだ表示されていません') });
  });

  it('部門が特定できなければ質問する', () => {
    const result = resolveOperationInstruction('6つの問いの1番目に、地域の配送需要を取り込むと入力して', STAGE3_CTX);
    expect(result).toEqual({ kind: 'clarify', message: expect.stringContaining('どの部門') });
  });

  it('同じ回答が登録済みなら入力案を作らない', () => {
    expect(resolveOperationInstruction('宅配事業の6問の2番目に、既存と入力して', STAGE3_CTX)?.kind).toBe('clarify');
  });

  it('戦略書の再生成は、既存の生成処理を呼ぶ指示にする', () => {
    expect(resolveOperationInstruction('6問の回答を反映して宅配事業の戦略書を再生成して', STAGE3_CTX)).toEqual({
      kind: 'command',
      departmentName: '宅配事業',
    });
  });

  it('再生成で部門が特定できなければ質問する', () => {
    expect(resolveOperationInstruction('戦略書を再生成して', STAGE3_CTX)?.kind).toBe('clarify');
  });

  it('6問の部門データが無ければ、6問の入力は対象外にする', () => {
    expect(resolveOperationInstruction('6つの問いの1番目に、地域の配送需要を取り込むと入力して', BASE)).toBeNull();
  });
});

describe('contextDepartments と stage3AnswerOf', () => {
  it('章の先頭の steps を、6問の回答として取り出す', () => {
    const ctx = contextDepartments([
      { name: '宅配事業', answers2: [{ steps: [{ stepNumber: 1, question: 'q', answer: 'a' }] }] },
      { name: '新聞販売' },
    ]);
    expect(stage3AnswerOf(ctx, '宅配事業', 1)).toBe('a');
    expect(stage3AnswerOf(ctx, '新聞販売', 1)).toBe('');
  });
});

describe('resolveOperationInstruction：STAGE1 経営課題の追加', () => {
  const ISSUE_BASE: OperationContext = { ...BASE, stage1IssueTitles: ['既存顧客の離脱が増えている'] };

  it.each([
    '経営課題として「新規顧客の獲得が鈍い」を追加して',
    '経営課題として新規顧客の獲得が鈍いを追加しておいて',
    '新規顧客の獲得が鈍いを経営課題に追加して',
    '論点として「新規顧客の獲得が鈍い」を登録してください',
  ])('命令の形「%s」は、論点の入力案にする（保存はしない）', (text) => {
    const result = resolveOperationInstruction(text, ISSUE_BASE);
    expect(result).toEqual({
      kind: 'proposal',
      proposal: {
        kind: 'stage1.issue',
        pathname: '/stage1',
        companyId: 'company-1',
        strategyId: 'strategy-1',
        beforeTitles: ['既存顧客の離脱が増えている'],
        title: '新規顧客の獲得が鈍い',
        description: '',
      },
    });
  });

  it.each([
    '経営課題として新規顧客の獲得が鈍いを追加したほうがいいですか？',
    '新規顧客の獲得が鈍いを経営課題に追加すべきかな',
    'もし新規顧客が鈍いなら、経営課題に追加して',
    '経営課題として新規顧客の獲得が鈍いを追加したい',
    '経営課題に追加するかどうか考えている',
    '経営課題について、どう思いますか',
  ])('相談・仮定・希望「%s」は、操作にしない（通常の相談に任せる）', (text) => {
    expect(resolveOperationInstruction(text, ISSUE_BASE)).toBeNull();
  });

  it('内容が空なら、入力案を作らず、書き方を案内する', () => {
    const result = resolveOperationInstruction('経営課題として を追加して', ISSUE_BASE);
    expect(result?.kind).toBe('clarify');
  });

  it('同じ経営課題がすでにあれば、入力案を作らない', () => {
    const result = resolveOperationInstruction('経営課題として「既存顧客の離脱が増えている」を追加して', ISSUE_BASE);
    expect(result).toEqual({ kind: 'clarify', message: '同じ経営課題がすでにあるため、入力案は作りませんでした。' });
  });

  it('論点は5件までで、6件目は入力案を作らない', () => {
    const full = { ...BASE, stage1IssueTitles: ['a', 'b', 'c', 'd', 'e'] };
    const result = resolveOperationInstruction('経営課題として「新規顧客の獲得が鈍い」を追加して', full);
    expect(result?.kind).toBe('clarify');
  });

  it('金額を含む指示は、売上の入力案に任せる（経営課題にしない）', () => {
    const result = resolveOperationInstruction('2025年度の全社売上高を1億6,000万円として経営課題にも追加して', BASE);
    expect(result?.kind === 'proposal' && result.proposal.kind).toBe('stage1.revenue');
  });
});

describe('issueProposalOf：経営課題の入力案（説明文と上限・重複の検証）', () => {
  const CTX: OperationContext = { ...BASE, stage1IssueTitles: ['既存顧客の離脱が増えている'] };

  it('題名と説明文を入力案にする（保存はしない）', () => {
    const r = issueProposalOf('新規顧客の獲得力が弱い', '  新規の商談が増えないと話された。 ', CTX);
    expect(r).toEqual({
      kind: 'proposal',
      proposal: {
        kind: 'stage1.issue',
        pathname: '/stage1',
        companyId: 'company-1',
        strategyId: 'strategy-1',
        beforeTitles: ['既存顧客の離脱が増えている'],
        title: '新規顧客の獲得力が弱い',
        description: '新規の商談が増えないと話された。',
      },
    });
  });

  it('説明文が300字を超えたら入力案を作らない', () => {
    const r = issueProposalOf('新規顧客', 'あ'.repeat(301), CTX);
    expect(r.kind).toBe('clarify');
  });

  it('題名が空・100字超・重複・5件の上限では入力案を作らない', () => {
    expect(issueProposalOf('  ', '', CTX).kind).toBe('clarify');
    expect(issueProposalOf('あ'.repeat(101), '', CTX).kind).toBe('clarify');
    expect(issueProposalOf('既存顧客の離脱が増えている', '', CTX)).toEqual({
      kind: 'clarify',
      message: '同じ経営課題がすでにあるため、入力案は作りませんでした。',
    });
    expect(issueProposalOf('新しい課題', '', { ...BASE, stage1IssueTitles: ['a', 'b', 'c', 'd', 'e'] }).kind).toBe('clarify');
  });
});
