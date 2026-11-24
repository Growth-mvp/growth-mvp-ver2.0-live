import { appendDraftText, formatConsultDraft, isSameDraftTarget, parseConsultDraft } from './consultDraft';

const TARGET = { companyId: 'c1', strategyId: 's1', departmentId: 'd1', projectId: 'p1' };

describe('入力案の検証と整形', () => {
  it('課題・検討したこと・次の行動の形だけを受け付け、空の入力案は受け付けない', () => {
    expect(parseConsultDraft({ issues: ['配達の遅れ'], examined: ['ルートを分ける'], nextActions: ['週次で確認する'] })).toEqual({
      issues: ['配達の遅れ'],
      examined: ['ルートを分ける'],
      nextActions: ['週次で確認する'],
    });
    expect(parseConsultDraft({ issues: [], examined: [], nextActions: [] })).toBeNull();
    expect(parseConsultDraft({ issues: ['x'] })).toBeNull();
  });

  it('項目の数と長さの上限を超える入力案は受け付けない', () => {
    expect(parseConsultDraft({ issues: Array(6).fill('a'), examined: [], nextActions: [] })).toBeNull();
    expect(parseConsultDraft({ issues: ['a'.repeat(201)], examined: [], nextActions: [] })).toBeNull();
  });

  it('整形は、次の行動に「未実施」を付け、空の見出しを出さない', () => {
    const text = formatConsultDraft({ issues: ['配達の遅れ'], examined: [], nextActions: ['ルートを確認する'] });
    expect(text).toBe('【課題】\n・配達の遅れ\n\n【次の行動（未実施）】\n・ルートを確認する');
    expect(text).not.toContain('検討したこと');
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
