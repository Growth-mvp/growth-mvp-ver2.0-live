import { buildStage2Messages, checkStage2Integrity, isTwoStageRequest, TWO_STAGE_SYSTEM } from './twoStage';

const DRAFT = '2025年3月期の売上は930百万円、営業利益は52百万円です（STAGE1登録）。営業利益率は5.6％です。';

describe('第2段階の保持検査', () => {
  it('数値・固有名詞を保ったまま書き換えた場合は合格する', () => {
    const rewrite = 'そこは気になりますよね。2025年3月期は売上930百万円、営業利益52百万円でした。営業利益率は5.6％で、出所はSTAGE1登録です。';
    expect(checkStage2Integrity(DRAFT, rewrite)).toEqual({ ok: true, reason: null });
  });

  it('数値が欠けた場合は不合格にする', () => {
    expect(checkStage2Integrity(DRAFT, 'そこは気になりますよね。売上は930百万円です。STAGE1登録です。').reason).toBe('number_missing');
  });

  it('第1段階にない数値を追加した場合は不合格にする', () => {
    expect(checkStage2Integrity(DRAFT, '2025年3月期の売上930百万円、営業利益52百万円、営業利益率5.6％。STAGE1登録です。さらに2030年には10％成長します。').reason).toBe('number_added');
  });

  it('固有名詞（STAGE）が欠けた場合は不合格にする', () => {
    const draft = '2025年3月期の売上は930百万円、営業利益は52百万円です（GROWTH SHIFT登録）。';
    expect(checkStage2Integrity(draft, '2025年3月期の売上は930百万円、営業利益は52百万円です。').reason).toBe('name_missing');
  });

  it('極端に短い書き換えは不合格にする', () => {
    expect(checkStage2Integrity(DRAFT, 'はい。').reason).toBe('too_short');
  });

  it('空の書き換えは不合格にする', () => {
    expect(checkStage2Integrity(DRAFT, '  ').reason).toBe('empty');
  });

  it('URLが欠けた場合は不合格にする', () => {
    const draft = `${DRAFT} 出典：https://example.com/a`;
    const rewrite = '2025年3月期の売上930百万円、営業利益52百万円、営業利益率5.6％です。STAGE1登録です。';
    expect(checkStage2Integrity(draft, rewrite).reason).toBe('url_missing');
  });
});

describe('第2段階の入力', () => {
  it('企業情報を含まず、直前の会話は2件までに絞る', () => {
    const messages = buildStage2Messages({
      question: '価格を下げた方がよいでしょうか？',
      history: [
        { role: 'user', content: '1' },
        { role: 'assistant', content: '2' },
        { role: 'user', content: '3' },
        { role: 'assistant', content: '4' },
      ],
      draft: DRAFT,
    });
    expect(messages[0].content).toBe(TWO_STAGE_SYSTEM);
    expect(messages[1].content).toContain('【直前の会話（参考）】');
    expect(messages[1].content).toContain('AI：4');
    expect(messages[1].content).not.toContain('相談者：1');
  });

  it('第2段階の依頼だけを、本体の依頼と区別できる', () => {
    expect(isTwoStageRequest(TWO_STAGE_SYSTEM)).toBe(true);
    expect(isTwoStageRequest('あなたは、経営相談の機能として回答します。')).toBe(false);
  });
});

describe('数値の表記の違い', () => {
  it('「0円」と「ゼロ円」、全角と半角の数字は同じ数値として扱う', () => {
    expect(checkStage2Integrity('見通しは施策効果0円です。STAGE1登録です。', '見通しは施策効果ゼロ円です。STAGE1登録です。').ok).toBe(true);
    expect(checkStage2Integrity('売上930百万円、STAGE1登録。', '売上９３０百万円、STAGE1登録。').ok).toBe(true);
  });
});
