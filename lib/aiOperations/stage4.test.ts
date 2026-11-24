import { dueYmFrom, goalAfter, matchAction, parseStage4Intent } from './stage4';

describe('parseStage4Intent', () => {
  it.each([
    ['このプロジェクトの実行計画書を作って', 'generate'],
    ['宅配事業の実行計画書を作成して', 'generate'],
    ['目的に、地域顧客の利便性向上を追加して', 'goal'],
    ['この実施事項の期限を来年3月末に変更して', 'due'],
    ['実施事項に、配送ルートの見直しを追加して', 'action-add'],
    ['この内容で保存して', 'save'],
  ])('「%s」は %s', (text, kind) => {
    expect(parseStage4Intent(text)?.kind).toBe(kind);
  });

  it('目的の追加では、追加する文を取り出す', () => {
    expect(parseStage4Intent('目的に、地域顧客の利便性向上を追加して')).toEqual({ kind: 'goal', addition: '地域顧客の利便性向上' });
  });

  it('期限の変更では、対象の語句と期限の文を取り出す', () => {
    expect(parseStage4Intent('実施事項の配送ルートの見直しの期限を来年3月末に変更して')).toEqual({
      kind: 'due',
      actionHint: '配送ルートの見直し',
      dueText: '来年3月末',
    });
  });

  it('質問や関係のない文は対象にしない', () => {
    expect(parseStage4Intent('実行計画の進め方を教えてください')).toBeNull();
    expect(parseStage4Intent('宅配事業の戦略を考えたい')).toBeNull();
  });
});

describe('dueYmFrom', () => {
  const now = new Date(2026, 10, 25);
  it('来年・今年・年を明示した期限を YYYY-MM にする', () => {
    expect(dueYmFrom('来年3月末', now)).toBe('2027-03');
    expect(dueYmFrom('今年12月', now)).toBe('2026-12');
    expect(dueYmFrom('2028年1月末', now)).toBe('2028-01');
  });

  it('読めない期限は null', () => {
    expect(dueYmFrom('そのうち', now)).toBeNull();
    expect(dueYmFrom('13月', now)).toBeNull();
  });
});

describe('goalAfter', () => {
  it('既存の目的を消さず、追加する文を続ける', () => {
    expect(goalAfter('新聞を届ける。', '地域顧客の利便性向上')).toBe('新聞を届ける、地域顧客の利便性向上。');
    expect(goalAfter('', '地域顧客の利便性向上')).toBe('地域顧客の利便性向上。');
  });
});

describe('matchAction', () => {
  const actions = [
    { order: 1, title: '配送ルートを見直す' },
    { order: 2, title: '購読者への案内を出す' },
  ];

  it('指示の語句で1つに決まれば、その実施事項', () => {
    expect(matchAction(actions, '配送ルートの見直し')).toEqual(actions[0]);
  });

  it('語句で決まらず実施事項が複数なら、確認が必要', () => {
    expect(matchAction(actions, 'まったく別の話')).toEqual({ ambiguous: ['1. 配送ルートを見直す', '2. 購読者への案内を出す'] });
  });

  it('実施事項が1つだけなら、それを対象にする', () => {
    expect(matchAction([actions[0]], '')).toEqual(actions[0]);
  });

  it('実施事項が無ければ null', () => {
    expect(matchAction([], '配送')).toBeNull();
  });
});
