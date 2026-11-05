import {
  CEO_SEARCH_INSTRUCTIONS,
  parseSearchResponse,
  runPublicSearch,
  toPublicSourceUrl,
} from './search';

type Client = Parameters<typeof runPublicSearch>[0];

const createMock = jest.fn();
const client = { responses: { create: (...args: unknown[]) => createMock(...args) } } as unknown as Client;

const URL_A = 'https://example.com/can-market-2025';
const URL_B = 'https://example.org/food-container';

function cite(text: string, anchor: string, url: string, title = '業界統計') {
  const end = text.indexOf(anchor) + anchor.length;
  return { type: 'url_citation', url, title, start_index: end - anchor.length, end_index: end };
}

function messageWith(text: string, annotations: unknown[]) {
  return {
    output: [
      { type: 'web_search_call', id: 'ws1', status: 'completed', action: { type: 'search' } },
      { type: 'message', content: [{ type: 'output_text', text, annotations }] },
    ],
  };
}

beforeEach(() => {
  createMock.mockReset();
});

describe('検索リクエストの内容', () => {
  it('検索は1回だけ、非公開データを含まない固定の指示と渡された入力で送る', async () => {
    createMock.mockResolvedValue({ output: [] });
    await runPublicSearch(client, '業界: 情報通信・IT\n公開分類の一覧', 12_000);

    expect(createMock).toHaveBeenCalledTimes(1);
    const [params, options] = createMock.mock.calls[0];
    expect(params).toMatchObject({
      model: 'gpt-5.6-luna',
      max_output_tokens: 2500,
      reasoning: { effort: 'low' },
      tools: [{ type: 'web_search' }],
      tool_choice: 'required',
      store: false,
      instructions: expect.stringContaining(CEO_SEARCH_INSTRUCTIONS),
      input: '業界: 情報通信・IT\n公開分類の一覧',
    });
    expect(params.include).toEqual(['web_search_call.action.sources']);
    expect(options).toEqual({ timeout: 12_000, maxRetries: 0 });
  });
});

describe('検索結果の解析と出典', () => {
  it('出典つきの行だけを事実として採用し、URLは https のみ・追跡パラメータを除く', async () => {
    const line1 = '金属缶の出荷数量は2025年の暦年で前年を下回った。';
    const line2 = '食品メーカーの容器需要は増加の見込み。';
    const text = `${line1}\n${line2}`;
    createMock.mockResolvedValue(
      messageWith(text, [
        cite(text, line1, `${URL_A}?utm_source=x`),
        cite(text, line2, URL_B),
      ])
    );

    const r = await runPublicSearch(client, 'q');
    expect(r.status).toBe('completed');
    expect(r.facts).toEqual([
      { text: line1, sources: [{ title: '業界統計', url: URL_A }], period: null, publishedOn: null, kind: null },
      { text: line2, sources: [{ title: '業界統計', url: URL_B }], period: null, publishedOn: null, kind: null },
    ]);
    expect(r.confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('出典の付かない行は事実として採用しない', async () => {
    const cited = '金属缶の需要は横ばいだった。';
    const uncited = '根拠のない断定の一文です。';
    const text = `${cited}\n${uncited}`;
    const facts = parseSearchResponse(messageWith(text, [cite(text, cited, URL_A)]));
    expect(facts.map((f) => f.text)).toEqual([cited]);
  });

  it('http・資格情報つき・エラーページの出典は除外し、残りが無ければ結果なしとする', async () => {
    const line = '金属缶の動向に関する一文。';
    const badUrls = ['http://example.com/a', 'https://user:pw@example.com/a', 'https://example.com/404.html'];
    for (const url of badUrls) {
      createMock.mockResolvedValueOnce(messageWith(line, [cite(line, line, url)]));
      const r = await runPublicSearch(client, 'q');
      expect(r.status).toBe('no_results');
      expect(r.facts).toEqual([]);
    }
  });

  it('検索結果の本文が無い・出典が無い場合は結果なし（出典不明の事実は渡さない）', async () => {
    createMock.mockResolvedValueOnce({ output: [{ type: 'web_search_call', status: 'completed' }] });
    expect((await runPublicSearch(client, 'q')).status).toBe('no_results');

    const text = '出典のない事実。';
    createMock.mockResolvedValueOnce(messageWith(text, []));
    expect((await runPublicSearch(client, 'q')).status).toBe('no_results');
  });

  it('1行は300文字までに切り、事実は最大12件まで', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `事実${i}：${'あ'.repeat(400)}`);
    const text = lines.join('\n');
    const annotations = lines.map((l) => cite(text, l, URL_A));
    const facts = parseSearchResponse(messageWith(text, annotations));
    expect(facts).toHaveLength(12);
    expect(facts[0].text.length).toBeLessThanOrEqual(300);
  });

  it('toPublicSourceUrl は https の通常URLだけを返す', () => {
    expect(toPublicSourceUrl('https://example.com/a?utm_medium=b&id=1', 'x')).toBe('https://example.com/a?id=1');
    expect(toPublicSourceUrl('javascript:alert(1)', 'x')).toBeNull();
    expect(toPublicSourceUrl(undefined, 'x')).toBeNull();
    expect(toPublicSourceUrl('https://example.com/a', 'Page Not Found')).toBeNull();
  });
});

describe('障害の区別', () => {
  it('429 は利用上限として区別し、再試行しない', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('rate'), { status: 429 }));
    const r = await runPublicSearch(client, 'q');
    expect(r.status).toBe('rate_limited');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('SDK のタイムアウトは timeout として区別する', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'APIConnectionTimeoutError' }));
    expect((await runPublicSearch(client, 'q')).status).toBe('timeout');
  });

  it('応答が時間内に返らない場合は timeout とし、待ち続けない', async () => {
    createMock.mockReturnValue(new Promise(() => undefined));
    const r = await runPublicSearch(client, 'q', 20);
    expect(r.status).toBe('timeout');
    expect(r.facts).toEqual([]);
  });

  it('その他の接続失敗は failed とし、エラー内容は結果に含めない', async () => {
    createMock.mockRejectedValue(new Error('secret-internal-detail'));
    const r = await runPublicSearch(client, 'q');
    expect(r.status).toBe('failed');
    expect(JSON.stringify(r)).not.toContain('secret-internal-detail');
  });
});
