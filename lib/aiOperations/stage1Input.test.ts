import { resolveStage1Input, type Stage1InputContext } from './stage1Input';

function ctx(over: Partial<Stage1InputContext> & { yen?: number | null } = {}): Stage1InputContext {
  return {
    segmentNames: ['製造事業', 'フィットネス'],
    issueTitles: ['新規顧客の獲得が鈍い', '既存顧客の離脱が増えている'],
    financeYen: () => over.yen ?? null,
    ...over,
  };
}

describe('STAGE1の入力依頼：対象と値の読み取り', () => {
  it('事業の追加は、事業名だけを入力操作にする', () => {
    expect(resolveStage1Input('事業にカフェを追加してください', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'segment.add', name: 'カフェ' },
      confirm: false,
    });
  });

  it('同じ名前の事業や上限の超過は、入力操作にせず確認を求める', () => {
    expect(resolveStage1Input('事業に製造事業を追加して', ctx())).toEqual({ kind: 'clarify', message: '「製造事業」という事業はすでにあります。' });
    const full = ctx({ segmentNames: Array.from({ length: 10 }, (_, i) => `事業${i}`) });
    expect(resolveStage1Input('事業にカフェを追加して', full)).toEqual({ kind: 'clarify', message: '事業は10件までです。' });
  });

  it('事業の顧客は、登録中の事業に対して、語尾の「です」を除いた値で入力する', () => {
    expect(resolveStage1Input('フィットネス事業の主な顧客は地域の高齢者です', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'segment.set', name: 'フィットネス', field: 'keyCustomers', value: ['地域の高齢者'] },
      confirm: false,
    });
  });

  it('名前に「事業」を含む事業でも、正しい事業を選ぶ', () => {
    const r = resolveStage1Input('製造事業の事業概要は、部品の受託加工です', ctx());
    expect(r).toMatchObject({ kind: 'op', op: { kind: 'segment.set', name: '製造事業', field: 'summary', value: '部品の受託加工' } });
  });

  it('登録されていない事業の指示は、追加を案内して確認する', () => {
    const r = resolveStage1Input('ヨガ事業の主な顧客は会社員です', ctx());
    expect(r).toMatchObject({ kind: 'clarify' });
  });

  it('事業名の変更は、既存の事業を指定して行う', () => {
    expect(resolveStage1Input('製造事業の事業名を製造・加工事業に変更してください', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'segment.rename', from: '製造事業', to: '製造・加工事業' },
      confirm: false,
    });
  });

  it('従業員数は人数を人数帯に直して入力する（30名は20〜49名）', () => {
    expect(resolveStage1Input('従業員数を30名に変更してください', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'profile', field: 'employees', value: '20〜49', display: '30名（20〜49名）' },
      confirm: false,
    });
    expect(resolveStage1Input('従業員数を1200名にしてください', ctx())).toMatchObject({
      op: { kind: 'profile', field: 'employees', value: '1000以上' },
    });
  });

  it('業種・所在地・決算月は、選択肢にある値だけを受け付ける', () => {
    expect(resolveStage1Input('業種は製造業です', ctx())).toMatchObject({ op: { kind: 'profile', field: 'industry', value: 'manufacturing' } });
    expect(resolveStage1Input('本社所在地は東京都です', ctx())).toMatchObject({ op: { kind: 'profile', field: 'location', value: '東京都' } });
    expect(resolveStage1Input('決算月を3月に変更してください', ctx())).toMatchObject({ op: { kind: 'profile', field: 'fiscalYearEnd', value: '3' } });
    expect(resolveStage1Input('決算月は13月です', ctx())).toMatchObject({ kind: 'clarify' });
    expect(resolveStage1Input('業種は宇宙業です', ctx())).toMatchObject({ kind: 'clarify' });
    expect(resolveStage1Input('従業員数はたくさんです', ctx())).toMatchObject({ kind: 'clarify' });
  });

  it('会社名は、語尾を除いた名前を入力する', () => {
    expect(resolveStage1Input('会社名を株式会社センターボードに変更してください', ctx())).toMatchObject({
      op: { kind: 'profile', field: 'companyName', value: '株式会社センターボード' },
    });
  });

  it('年度と項目と金額がそろった財務の入力は、符号つきの円で入力する', () => {
    expect(resolveStage1Input('2025年度の営業利益は500万円です', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'finance', table: 'pl', key: 'operatingIncome', label: '営業利益', year: 2025, yen: 5_000_000 },
      confirm: false,
    });
    expect(resolveStage1Input('2025年度の営業利益は▲300万円です', ctx())).toMatchObject({
      op: { kind: 'finance', key: 'operatingIncome', yen: -3_000_000 },
    });
    expect(resolveStage1Input('2025年度の営業利益は赤字300万円です', ctx())).toMatchObject({
      op: { kind: 'finance', key: 'operatingIncome', yen: -3_000_000 },
    });
  });

  it('事業別の財務は、事業を指定して入力する', () => {
    expect(resolveStage1Input('製造事業の2025年度の売上高は10億円です', ctx())).toMatchObject({
      op: { kind: 'finance', table: 'pl', key: 'revenue', year: 2025, yen: 1_000_000_000, segment: '製造事業' },
    });
  });

  it('全社の売上高は、従来の全社売上高の入力に任せる', () => {
    expect(resolveStage1Input('2025年度の売上高は1億6,000万円です', ctx())).toBeNull();
  });

  it('既存値を大きく変える財務は、確認が必要として返す', () => {
    const big = resolveStage1Input('2025年度の営業利益は500万円です', ctx({ yen: 1_000_000 }));
    expect(big).toMatchObject({ kind: 'op', confirm: true, op: { expectedBefore: 1_000_000 } });
    const small = resolveStage1Input('2025年度の営業利益は1100万円です', ctx({ yen: 10_000_000 }));
    expect(small).toMatchObject({ kind: 'op', confirm: false });
  });

  it('経営課題の説明は、「」で示した題名で特定して修正する', () => {
    expect(resolveStage1Input('経営課題「新規顧客の獲得が鈍い」の説明を既存顧客の離脱も含めて整理に修正して', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'issue.edit', title: '新規顧客の獲得が鈍い', field: 'description', value: '既存顧客の離脱も含めて整理' },
      confirm: false,
    });
  });

  it('「先ほどの経営課題」のように特定できない修正は、題名を尋ねる', () => {
    expect(resolveStage1Input('先ほどの経営課題の説明を修正してください', ctx())).toMatchObject({ kind: 'clarify' });
  });

  it('経営課題の対象範囲と根拠となる指標も修正する', () => {
    expect(resolveStage1Input('経営課題「新規顧客の獲得が鈍い」の対象範囲を事業に変更', ctx())).toMatchObject({
      op: { kind: 'issue.edit', field: 'scope', value: 'business' },
    });
    expect(resolveStage1Input('経営課題「新規顧客の獲得が鈍い」の根拠となる指標をROICとWACCに変更してください', ctx())).toMatchObject({
      op: { kind: 'issue.edit', field: 'linkedMetrics', value: ['roic', 'wacc'] },
    });
  });

  it('前提条件（WACC）・企業価値分析・保存・STAGE2への引き渡しを読み取る', () => {
    expect(resolveStage1Input('WACCを5.5%に変更してください', ctx())).toMatchObject({ op: { kind: 'wacc', pct: 5.5 } });
    expect(resolveStage1Input('企業価値分析を更新してください', ctx())).toMatchObject({ op: { kind: 'valuation' } });
    expect(resolveStage1Input('保存して', ctx())).toEqual({ kind: 'action', action: { kind: 'save' } });
    expect(resolveStage1Input('STAGE2へ進めて', ctx())).toEqual({ kind: 'action', action: { kind: 'handover' } });
  });
});

describe('STAGE1の入力依頼：指示として扱わないもの', () => {
  it.each([
    '事業にカフェを追加したい',
    'もし事業にカフェを追加するならどうですか',
    '事業にカフェを追加しないで',
    'やっぱり従業員数は変えないでおく',
    '2025年度の営業利益は500万円ですか',
    '2025年度の営業利益は前年より500万円増えた',
    'ここまでの分析をもとに経営戦略を考えたい',
    '保存しないで',
  ])('「%s」は入力操作にしない（通常の相談に任せる）', (text) => {
    expect(resolveStage1Input(text, ctx())).toBeNull();
  });
});
