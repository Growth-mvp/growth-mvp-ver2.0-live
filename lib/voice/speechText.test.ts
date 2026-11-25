import { toSpeakableChunks } from './speechText';

const joined = (md: string) => toSpeakableChunks(md).join('');

describe('toSpeakableChunks：読み上げに不要な記号を除く', () => {
  it('見出し・強調・箇条書きの記号は読まない', () => {
    const text = joined('## 結論\n**売上**が伸びています。\n- 配送の見直し\n1. 価格を確認');
    expect(text).toBe('結論売上が伸びています。配送の見直し価格を確認');
  });

  it('表は読み上げない', () => {
    const text = joined('結論は次のとおりです。\n| 項目 | 値 |\n|---|---|\n| 売上 | 1億 |\n以上です。');
    expect(text).not.toContain('|');
    expect(text).toContain('結論は次のとおりです。');
    expect(text).toContain('以上です。');
  });

  it('URL は読まず、リンクは文字だけを読む', () => {
    const text = joined('詳しくは[公式サイト](https://example.com/a)をご覧ください。');
    expect(text).toBe('詳しくは公式サイトをご覧ください。');
  });

  it('コードブロックと診断表示は読まない', () => {
    const text = joined('結論です。\n```\nconst x = 1;\n```\n[debug] mode=facilitator\n次の一歩です。');
    expect(text).not.toContain('const');
    expect(text).not.toContain('debug');
    expect(text).toContain('次の一歩です。');
  });

  it('読みにくい記号（■・※・→）は除くか読める語にする', () => {
    const text = joined('■ 要点\n※注意 売上→利益');
    expect(text).not.toContain('■');
    expect(text).not.toContain('※');
    expect(text).toContain('売上、利益');
  });
});

describe('toSpeakableChunks：文の途中で切らない', () => {
  it('句点の位置で文に分け、それぞれを読み上げの単位にする', () => {
    const chunks = toSpeakableChunks('今月の売上は前年を上回りました。一方で利益は横ばいです。次に配送費を見直します。');
    expect(chunks.join('')).toBe('今月の売上は前年を上回りました。一方で利益は横ばいです。次に配送費を見直します。');
    chunks.forEach((c) => expect(c.endsWith('。') || c.length > 0).toBe(true));
  });

  it('長い文は読点で区切り、単語の途中で切らない', () => {
    const long = '配送の効率を上げるために、拠点の統合を検討し、そのうえで配送ルートを見直し、人員の配置も合わせて考え、さらに車両の稼働率と燃料費の推移を毎月確認し、結果を現場の担当者と共有しながら進めていくことが必要で、そのうえで月次の報告会で経営陣が進捗を確認し、必要に応じて計画そのものを見直していくことにします。';
    const chunks = toSpeakableChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(110));
    expect(chunks.join('')).toBe(long);
  });

  it('極端に短い断片は前後と合わせ、短い声切れを減らす', () => {
    const chunks = toSpeakableChunks('はい。そうです。確認しましょう。');
    expect(chunks.every((c) => c.length >= 4)).toBe(true);
  });

  it('空や記号だけの入力からは何も読まない', () => {
    expect(toSpeakableChunks('  \n  ')).toEqual([]);
    expect(toSpeakableChunks('---')).toEqual([]);
  });
});

describe('toSpeakableChunks：長い回答は冒頭の結論から読む', () => {
  const conclusion = '結論として、配送拠点の統合を最優先に進めるのがよいと考えます。';
  const reason = '理由は、配送費が売上の八パーセントを占めており、拠点ごとの稼働率にばらつきがあるためです。';
  const detail = `${'詳細な分析の内容を説明すると、'.repeat(12)}。`;

  it('長い回答は、冒頭の文だけを文の途中で切らずに読み、詳しい内容は画面にあることを伝える', () => {
    expect(joined(`${conclusion}${reason}${detail}`)).toBe(`${conclusion}${reason}詳しい内容は画面に表示しています。`);
  });

  it('短い回答は全文を読み、案内を足さない', () => {
    expect(joined(`${conclusion}${reason}`)).toBe(`${conclusion}${reason}`);
  });
});
