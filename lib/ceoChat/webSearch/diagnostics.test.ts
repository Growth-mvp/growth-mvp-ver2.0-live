import { parseSearchResponseWithStats } from './search';
import { countFactEntities } from './entity';
import { countUrls } from './sourceCheck';
import { resolveCeoWebSearch } from './index';

const NOW = new Date('2026-11-05T00:00:00Z');
const COMPANY = '日本製罐株式会社';
const URL_A = 'https://example.com/nippon-ir';

const OWN_LINE = '日本製罐の2024年3月期の美術缶売上は前年を上回った。 ｜ 対象期間: 2024年3月期 ｜ 公表日: 2024-05-15 ｜ 種別: 年間統計';
const NO_CITE_LINE = '出典のない一文です。';

function cite(text: string, anchor: string, url: string) {
  const end = text.indexOf(anchor) + anchor.length;
  return { type: 'url_citation', url, title: '出典', start_index: end - anchor.length, end_index: end };
}

describe('検索結果の件数（診断）', () => {
  it('出力の項目の種類と件数、url_citation の件数、対応づいた行と除外した行を数える', () => {
    const text = `${OWN_LINE}\n${NO_CITE_LINE}`;
    const res = {
      output: [
        { type: 'web_search_call', status: 'completed', id: 'ws1', action: { type: 'search' } },
        { type: 'reasoning', id: 'r1' },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text,
              annotations: [cite(text, OWN_LINE, URL_A), { type: 'file_citation', file_id: 'x' }],
            },
          ],
        },
      ],
    };
    const { facts, stats } = parseSearchResponseWithStats(res, NOW);
    expect(facts).toHaveLength(1);
    expect(stats).toEqual({
      outputTypes: { web_search_call: 1, reasoning: 1, message: 1 },
      urlCitations: 1,
      attributedFacts: 1,
      droppedLines: 1,
    });
  });

  it('応答が空の場合は、件数もすべて 0', () => {
    const { facts, stats } = parseSearchResponseWithStats({ output: [] }, NOW);
    expect(facts).toEqual([]);
    expect(stats).toEqual({ outputTypes: {}, urlCitations: 0, attributedFacts: 0, droppedLines: 0 });
  });
});

describe('事実の分類の件数（自社・競合・市場・分類不能）', () => {
  it('各区分の件数を数え、日本製罐は自社として数える', () => {
    const counts = countFactEntities(
      [OWN_LINE, '東洋製罐株式会社は受注を伸ばした。', '金属缶市場の出荷は横ばいだった。', '日本製罐グループの海外事業は拡大した。'],
      COMPANY
    );
    expect(counts).toEqual({ self: 1, competitor: 1, market: 1, unclassified: 1 });
  });
});

describe('回答中のURL件数', () => {
  it('URL の件数だけを返し、URL 自体は返さない', () => {
    expect(countUrls('根拠は https://example.com/a と https://example.org/b です。')).toBe(2);
    expect(countUrls('URLはありません。')).toBe(0);
  });
});

describe('外部検索の診断情報（件数と状態のみ）', () => {
  const strategy = {
    companyName: COMPANY,
    industry: 'manufacturing',
    businessContent: '美術缶を製造・販売',
    businessSegments: [],
  };

  it('検索の結果から診断情報を作り、企業名・本文・URL を含めない', async () => {
    const response = {
      output: [
        { type: 'web_search_call', status: 'completed', id: 'ws1', action: { type: 'search' } },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: OWN_LINE,
              annotations: [cite(OWN_LINE, OWN_LINE, URL_A)],
            },
          ],
        },
      ],
    };
    const client = { responses: { create: jest.fn(async () => response) } } as any;
    const r = await resolveCeoWebSearch({
      enabled: true,
      question: '金属缶市場の最新動向を教えてください',
      strategy,
      client,
    });
    expect(r.diagnostics).toMatchObject({
      status: 'completed',
      sourceCount: 1,
      outputTypes: { web_search_call: 1, message: 1 },
      urlCitations: 1,
      attributedFacts: 1,
      droppedLines: 0,
      periodKnown: 1,
      publishedKnown: 1,
      entities: { self: 1, competitor: 0, market: 0, unclassified: 0 },
      allowedUrls: 1,
    });
    expect(typeof r.diagnostics?.elapsedMs).toBe('number');
    const text = JSON.stringify(r.diagnostics);
    expect(text).not.toContain(COMPANY);
    expect(text).not.toContain('日本製罐');
    expect(text).not.toContain(URL_A);
    expect(text).not.toContain('金属缶市場');
  });

  it('検索が失敗した場合も、状態と 0 の件数を返す', async () => {
    const client = {
      responses: { create: jest.fn(async () => { throw Object.assign(new Error('rate'), { status: 429 }); }) },
    } as any;
    const r = await resolveCeoWebSearch({
      enabled: true,
      question: '金属缶市場の最新動向を教えてください',
      strategy,
      client,
    });
    expect(r.diagnostics).toMatchObject({ status: 'rate_limited', attributedFacts: 0, allowedUrls: 0 });
  });

  it('検索を行わない場合は、診断情報を作らない', async () => {
    const r = await resolveCeoWebSearch({ enabled: false, question: '金属缶市場', strategy, client: {} as any });
    expect(r.diagnostics).toBeNull();
  });
});
