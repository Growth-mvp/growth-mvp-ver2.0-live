import { buildSearchInstructions, parseFactLine, parsePublishedOn, parseSearchResponse } from './search';

const NOW = new Date('2026-11-05T00:00:00Z');

describe('検索結果の行から、対象期間・公表日・種別を読む', () => {
  it('末尾の項目を読み取り、事実の本文と分けて扱う', () => {
    const f = parseFactLine('金属缶の出荷は増えた ｜ 対象期間: 2025年 ｜ 公表日: 2026-03-10 ｜ 種別: 年間統計', NOW);
    expect(f).toEqual({
      text: '金属缶の出荷は増えた',
      period: '2025年',
      publishedOn: '2026-03-10',
      kind: 'annual',
    });
  });

  it('月次・四半期の種別は速報として扱う', () => {
    const f = parseFactLine('出荷は増加 ｜ 対象期間: 2026年1〜3月 ｜ 公表日: 不明 ｜ 種別: 四半期速報', NOW);
    expect(f.kind).toBe('flash');
    expect(f.period).toBe('2026年1〜3月');
  });

  it('「不明」と書かれた項目は、null のまま（推測で補わない）', () => {
    const f = parseFactLine('出荷は増加 ｜ 対象期間: 不明 ｜ 公表日: 不明 ｜ 種別: 不明', NOW);
    expect(f.period).toBeNull();
    expect(f.publishedOn).toBeNull();
    expect(f.kind).toBeNull();
  });

  it('項目が無い行は、公表日を確認日から補わない', () => {
    const f = parseFactLine('金属缶の出荷は増えた', NOW);
    expect(f).toEqual({ text: '金属缶の出荷は増えた', period: null, publishedOn: null, kind: null });
  });

  it('全角の区切り（｜）と半角の区切り（|）のどちらも読む', () => {
    const f = parseFactLine('出荷は増加 | 対象期間: 2025年 | 公表日: 2026-02-01', NOW);
    expect(f).toMatchObject({ period: '2025年', publishedOn: '2026-02-01' });
  });
});

describe('公表日の正規化', () => {
  it.each([
    ['2026-03-10', '2026-03-10'],
    ['2026/3/10', '2026-03-10'],
    ['2026年3月10日', '2026-03-10'],
    ['2026-03', '2026-03'],
    ['2026', '2026'],
  ])('%s は %s として扱う', (input, expected) => {
    expect(parsePublishedOn(input, NOW)).toBe(expected);
  });

  it.each(['不明', '未確認', '', '2099-01-01', '2026-13', '2026-02-40', '昨年', '1800-01-01'])(
    '%s は採用しない',
    (input) => {
      expect(parsePublishedOn(input, NOW)).toBeNull();
    }
  );
});

describe('検索結果の解析（出典と項目の対応）', () => {
  it('出典つきの行から、事実・項目・出典を対応させて取り出す', () => {
    const line = '金属缶の出荷は増えた ｜ 対象期間: 2025年 ｜ 公表日: 2026-03-10 ｜ 種別: 年間統計';
    const text = `${line}\n出典のない行 ｜ 対象期間: 2024年`;
    const res = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text,
              annotations: [
                { type: 'url_citation', url: 'https://example.com/stat', title: '統計', start_index: 0, end_index: line.length },
              ],
            },
          ],
        },
      ],
    };
    const facts = parseSearchResponse(res, NOW);
    expect(facts).toEqual([
      {
        text: '金属缶の出荷は増えた',
        period: '2025年',
        publishedOn: '2026-03-10',
        kind: 'annual',
        sources: [{ title: '統計', url: 'https://example.com/stat' }],
      },
    ]);
  });
});

describe('検索指示', () => {
  it('本日の日付と、最新資料・速報・対象期間の扱いを指示する', () => {
    const s = buildSearchInstructions(NOW);
    expect(s).toContain('本日は2026-11-05です');
    expect(s).toContain('利用可能な最新の信頼できる資料を優先');
    expect(s).toContain('最新の年間統計と、直近の月次・四半期速報は区別');
    expect(s).toContain('過去の資料しか見つからない場合は、その対象期間を明示');
    expect(s).toContain('｜ 対象期間:');
    expect(s).toContain('日付を推測して補わないでください');
  });

  it('自社名や外部に送ってはいけない内部情報を含まない', () => {
    const s = buildSearchInstructions(NOW);
    expect(s).not.toContain('日本製罐');
    expect(s).not.toContain('株式会社');
  });
});
