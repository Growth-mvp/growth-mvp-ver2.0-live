import { allowStage2Candidate, parseStage2Candidate, parseStage2Context, resolveStage2Input, type Stage2InputContext } from './stage2Input';

const ctx = (over: Partial<Stage2InputContext> = {}): Stage2InputContext => ({
  targets: [{ id: 't-1', label: '営業利益', unit: '万円', base: 5000 }],
  focusQuestionId: 'ch1-q2',
  questionIds: ['ch0-q1', 'ch1-q2'],
  swot: { strength: '技術力\n顧客との信頼', weakness: '人手不足', opportunity: '', threat: '' },
  answers: {},
  ...over,
});

describe('STAGE2の依頼の読み取り：入力', () => {
  it('経営者の思いへの追記は、追記する文を読み取る', () => {
    expect(resolveStage2Input('経営者の思いに、地域とのつながりを大切にしたいと追記して', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'ceo.append', text: '地域とのつながりを大切にしたい' },
    });
  });

  it('文脈を指す依頼（今の話を）は、読み取らず、直接の指定を求める', () => {
    expect(resolveStage2Input('今の話を経営者の思いに入れておいて', ctx())).toMatchObject({ kind: 'clarify' });
  });

  it('ミッション・ビジョン・バリューの設定を読み取る', () => {
    expect(resolveStage2Input('ミッションは、地域の暮らしを支えることに変更してください', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'mvv.set', field: 'mission', value: '地域の暮らしを支えること' },
    });
  });

  it('年度と金額を含む業績目標を、単位つきで新しい目標として読み取る', () => {
    expect(resolveStage2Input('2030年度の売上目標は8,000万円にしよう', ctx({ targets: [] }))).toEqual({
      kind: 'op',
      op: { kind: 'target.add', label: '売上', unit: '万円', base: 8000, dueYear: 2030 },
    });
  });

  it('同じ名前の業績目標は、追加ではなく目標値の修正として読み取る', () => {
    expect(resolveStage2Input('営業利益目標は6,000万円に修正して', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'target.setBase', id: 't-1', label: '営業利益', unit: '万円', base: 6000 },
    });
  });

  it('同じ名前の目標を、別の単位で指示した場合は確認を求める', () => {
    expect(resolveStage2Input('営業利益目標は6,000百万円に修正して', ctx())).toMatchObject({ kind: 'clarify' });
  });

  it('目標値の単位がない場合は、確認を求める', () => {
    expect(resolveStage2Input('2030年度の売上目標は8000にしよう', ctx({ targets: [] }))).toMatchObject({ kind: 'clarify' });
  });

  it('SWOTの追加は、項目を読み取る（強み・弱み・機会・脅威）', () => {
    expect(resolveStage2Input('強みに、現場の改善力を追加してください', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'swot.add', field: 'strength', text: '現場の改善力' },
    });
    expect(resolveStage2Input('脅威に人手不足を追加して', ctx())).toMatchObject({
      kind: 'op',
      op: { kind: 'swot.add', field: 'threat' },
    });
  });

  it('12の問いへの回答は、画面で選ばれている質問に対して読み取る', () => {
    expect(resolveStage2Input('この質問への回答は、既存顧客の紹介が多いです', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'answer.set', questionId: 'ch1-q2', text: '既存顧客の紹介が多い' },
    });
  });

  it('質問が選ばれていなければ、回答の対象を確認する', () => {
    expect(resolveStage2Input('この質問への回答は、紹介が多いです', ctx({ focusQuestionId: null }))).toMatchObject({ kind: 'clarify' });
  });
});

describe('STAGE2の依頼の読み取り：生成・確定', () => {
  it.each([
    ['戦略のたたき台を作って', 'draft'],
    ['戦略のたたき台を再生成して', 'draft'],
    ['経営戦略を生成して', 'final'],
    ['最終戦略を作成してください', 'final'],
    ['全社戦略を確定して', 'commit'],
    ['STAGE3へ引き渡して', 'commit'],
  ])('「%s」は、%s の依頼として読み取る', (text, kind) => {
    expect(resolveStage2Input(text, ctx())).toEqual({ kind: 'action', action: { kind } });
  });
});

describe('STAGE2の依頼の読み取り：操作として扱わないもの', () => {
  it.each([
    '経営者の思いに追記したいと考えています',
    'もし売上が落ちたら、目標を下げるべきかな',
    '2030年度の売上目標は8,000万円にするべきでしょうか',
    '経営戦略を確定しないで',
    'ここまでの分析をもとに経営戦略を考えたい',
  ])('「%s」は入力操作にしない', (text) => {
    expect(resolveStage2Input(text, ctx())).toBeNull();
  });
});

describe('STAGE2の依頼の読み取り：画面の操作（質問・承認・経営者の思い・SWOT）', () => {
  it('質問を開く依頼は、回答せず、その質問を表示する操作にする', () => {
    expect(resolveStage2Input('ch1-q2の質問を開いて', ctx())).toEqual({ kind: 'focus', questionId: 'ch1-q2' });
  });

  it('存在しない質問は、表示せず確認を求める', () => {
    expect(resolveStage2Input('ch9-q9の質問を開いて', ctx())?.kind).toBe('clarify');
  });

  it('業績目標の削除は、直接書き込まず承認の対象にする', () => {
    expect(resolveStage2Input('営業利益の目標を削除してください', ctx())).toEqual({
      kind: 'approval',
      op: { kind: 'target.remove', id: 't-1', label: '営業利益' },
    });
  });

  it('経営者の思いの全文の置き換えは、変更の依頼として読み取る', () => {
    expect(resolveStage2Input('経営者の思いを「地域の暮らしを支える会社です」に変更してください', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'ceo.set', text: '地域の暮らしを支える会社です' },
    });
  });

  it('SWOTの項目の修正は、項目の文で特定して置き換える', () => {
    expect(resolveStage2Input('強みの「顧客との信頼」を「顧客との長期的な信頼」に修正して', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'swot.replace', field: 'strength', from: '顧客との信頼', to: '顧客との長期的な信頼' },
    });
  });

  it('SWOTに無い項目の修正は、変更せず確認を求める', () => {
    expect(resolveStage2Input('強みの「別の技術」を「別の項目」に修正して', ctx())?.kind).toBe('clarify');
  });

  it('SWOTの項目の削除は、項目の文で特定する', () => {
    expect(resolveStage2Input('弱みから「人手不足」を削除して', ctx())).toEqual({
      kind: 'op',
      op: { kind: 'swot.remove', field: 'weakness', text: '人手不足' },
    });
  });
});

describe('STAGE2の操作候補の検証（相談の回答）', () => {
  it('存在しない目標IDや、知らない項目の文は捨てる', () => {
    expect(parseStage2Candidate({ kind: 'target.remove', id: 'x-9', label: '営業利益' }, ctx())).toBeNull();
    expect(parseStage2Candidate({ kind: 'swot.remove', field: 'strength', text: '存在しない' }, ctx())).toBeNull();
    expect(parseStage2Candidate({ kind: 'mvv.set', field: 'mission', value: '地域を支える' }, ctx())?.kind).toBe('mvv.set');
  });

  it('12の問いの回答は、存在する質問IDだけを受け取る', () => {
    expect(parseStage2Candidate({ kind: 'answer.set', questionId: 'ch9-q9', text: '回答' }, ctx())).toBeNull();
    expect(parseStage2Candidate({ kind: 'answer.set', questionId: 'ch1-q2', text: '回答' }, ctx())?.kind).toBe('answer.set');
  });

  it('形の合わない文脈は受け取らない', () => {
    expect(parseStage2Context({ targets: 'x' })).toBeNull();
    expect(parseStage2Context(null)).toBeNull();
  });
});

describe('STAGE2の操作候補の許可', () => {
  it('管理者が明示的に指示した場合だけ許可する', () => {
    expect(allowStage2Candidate({ lastUser: '今の話を経営者の思いに追記して', role: 'admin', enabled: true })).toBe(true);
    expect(allowStage2Candidate({ lastUser: '今の話を経営者の思いに追記して', role: 'manager', enabled: true })).toBe(false);
    expect(allowStage2Candidate({ lastUser: '今の話を経営者の思いに追記して', role: 'admin', enabled: false })).toBe(false);
    expect(allowStage2Candidate({ lastUser: 'もし経営者の思いに追記するとしたらどうなりますか', role: 'admin', enabled: true })).toBe(false);
  });
});
