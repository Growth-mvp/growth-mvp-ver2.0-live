import { buildAnswerStyleBlock, decideAnswerStyle } from './answerStyle';

describe('通常の相談の読みやすさと、分析の依頼の扱い', () => {
  it('採算の計算・分析を求める質問は詳細型のままにする（情報量を落とさない）', () => {
    expect(
      decideAnswerStyle({ userText: '宅配1件あたりの採算はどう計算すればよいでしょうか', hasPriorAssistantTurn: true }),
    ).toBe('detailed');
    expect(decideAnswerStyle({ userText: 'この事業の収益性を分析してほしい', hasPriorAssistantTurn: true })).toBe('detailed');
  });

  it('通常の相談の指示は、長さの目安と、番号付き手順・見出しを使わないことを含む', () => {
    const block = buildAnswerStyleBlock('conversation');
    expect(block).toContain('原則600字程度');
    expect(block).toContain('番号付きの手順や太字の小見出しで組み立てない');
  });

  it('詳細型の指示は、構造化を妨げない（従来どおり詳しく回答する）', () => {
    const block = buildAnswerStyleBlock('detailed');
    expect(block).toContain('従来どおり十分に詳しく回答する');
    expect(block).not.toContain('600字');
  });
});
