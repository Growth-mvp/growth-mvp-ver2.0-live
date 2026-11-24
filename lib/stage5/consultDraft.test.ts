import { appendDraftText, buildConsultDraft, formatConsultDraft, isSameDraftTarget } from './consultDraft';
import { splitSentences } from '@/lib/consult/sentenceSelection';

const TARGET = { companyId: 'c1', strategyId: 's1', departmentId: 'd1', projectId: 'p1' };
const Q = '最近、朝の配達が間に合わなくて焦っています。人手も足りないし、正直、このままでいいのか不安です。';

describe('相談文を文ごとに分ける', () => {
  it('文の中身を変えずに、句点で区切る', () => {
    expect(splitSentences(Q)).toEqual([
      '最近、朝の配達が間に合わなくて焦っています。',
      '人手も足りないし、正直、このままでいいのか不安です。',
    ]);
  });

  it('改行で区切られた文も、空の文は作らない', () => {
    expect(splitSentences('一行目\n\n二行目です。  ')).toEqual(['一行目', '二行目です。']);
  });
});

describe('AIが選んだ文番号から、本人の言葉を原文のまま取り出す', () => {
  it('本人の困りごとは、原文のまま残す（書き換えない）', () => {
    const d = buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [0, 1], plannedSentenceIndexes: [], insights: [] } });
    expect(d?.ownWords.join('')).toBe(Q);
    expect(formatConsultDraft(d!)).toBe(`【私が困っていること】\n${Q}`);
  });

  it('番号が範囲外・重複でも、原文の文だけを元の順で使う', () => {
    const d = buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [1, 1, 9], plannedSentenceIndexes: [], insights: [] } });
    expect(d?.ownWords).toEqual(['人手も足りないし、正直、このままでいいのか不安です。']);
  });

  it('本人の困りごとが1つも選ばれていなければ、入力案は作らない', () => {
    expect(buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [], plannedSentenceIndexes: [], insights: [] } })).toBeNull();
    expect(buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [9], plannedSentenceIndexes: [], insights: [] } })).toBeNull();
  });

  it('選ばれた文だけを使い、相談文のほかの内容は入らない', () => {
    const q = '朝の配達が遅れています。明日の天気はどうですか。';
    const d = buildConsultDraft({ question: q, selection: { ownSentenceIndexes: [0], plannedSentenceIndexes: [], insights: [] } });
    expect(formatConsultDraft(d!)).not.toContain('天気');
  });
});

describe('AIの整理は、本人の言葉とは別の補足として扱う', () => {
  it('気づきは【相談して気づいたこと（AIの補足）】に分け、本人の言葉には混ぜない', () => {
    const d = buildConsultDraft({
      question: Q,
      selection: { ownSentenceIndexes: [0], plannedSentenceIndexes: [], insights: ['人手の問題と、配達順の問題を分けて見る見方もできます。'] },
    });
    const text = formatConsultDraft(d!);
    expect(text).toContain('【私が困っていること】\n最近、朝の配達が間に合わなくて焦っています。');
    expect(text).toContain('【相談して気づいたこと（AIの補足）】\n・人手の問題と、配達順の問題を分けて見る見方もできます。');
    expect(text.indexOf('【相談して気づいたこと（AIの補足）】')).toBeGreaterThan(text.indexOf('【私が困っていること】'));
  });

  it('本人が試したいと述べた文だけを【これから試したいこと】に入れる。選ばれていなければ見出しも出さない', () => {
    const withPlan = buildConsultDraft({
      question: Q,
      selection: { ownSentenceIndexes: [0], plannedSentenceIndexes: [1], insights: [] },
    });
    expect(formatConsultDraft(withPlan!)).toContain('【これから試したいこと】\n人手も足りないし、正直、このままでいいのか不安です。');
    const withoutPlan = buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [0], plannedSentenceIndexes: [], insights: [] } });
    expect(formatConsultDraft(withoutPlan!)).not.toContain('これから試したいこと');
    expect(formatConsultDraft(withoutPlan!)).not.toContain('相談して気づいたこと');
  });

  it('本人の困りごとと同じ文は、試したいことに重ねて入れない', () => {
    const d = buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [0], plannedSentenceIndexes: [0], insights: [] } });
    expect(d?.plannedActions).toEqual([]);
  });

  it('気づきは最大3件・1件200字以内。超えるものは入力案の形として受け付けない', () => {
    expect(buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [0], plannedSentenceIndexes: [], insights: ['a', 'b', 'c', 'd'] } })).toBeNull();
    expect(buildConsultDraft({ question: Q, selection: { ownSentenceIndexes: [0], plannedSentenceIndexes: [], insights: ['a'.repeat(201)] } })).toBeNull();
  });

  it('選択の形が違う応答は受け付けない', () => {
    expect(buildConsultDraft({ question: Q, selection: { issues: ['AIが書いた課題'] } })).toBeNull();
    expect(buildConsultDraft({ question: Q, selection: 'not json' })).toBeNull();
  });
});

describe('入力中の文字を消さない追記', () => {
  it('入力が空なら、入力案をそのまま入れる', () => {
    expect(appendDraftText('', '案')).toBe('案');
    expect(appendDraftText('  \n ', '案')).toBe('案');
  });

  it('入力中の文字は残し、区切りを入れて末尾に追記する', () => {
    expect(appendDraftText('自分のメモ\n\n', '案')).toBe('自分のメモ\n\n案');
  });
});

describe('反映先の一致', () => {
  it('会社・戦略・部門・案件がすべて同じ時だけ一致とみなす', () => {
    expect(isSameDraftTarget(TARGET, { ...TARGET })).toBe(true);
    expect(isSameDraftTarget(TARGET, { ...TARGET, companyId: 'c2' })).toBe(false);
    expect(isSameDraftTarget(TARGET, { ...TARGET, projectId: 'p2' })).toBe(false);
    expect(isSameDraftTarget(TARGET, null)).toBe(false);
  });
});
