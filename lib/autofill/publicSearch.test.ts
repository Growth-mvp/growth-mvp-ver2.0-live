jest.mock('server-only', () => ({}));

import { searchPublicCompanyProfile } from './publicSearch';

type Line = { text: string; url?: string; title?: string };

function responseWith(lines: Line[]) {
  const annotations: Array<Record<string, unknown>> = [];
  let pos = 0;
  for (const l of lines) {
    const end = pos + l.text.length;
    if (l.url) annotations.push({ type: 'url_citation', url: l.url, title: l.title ?? '', start_index: pos, end_index: end });
    pos = end + 1;
  }
  return {
    output: [{ type: 'message', content: [{ type: 'output_text', text: lines.map((l) => l.text).join('\n'), annotations }] }],
  };
}

function clientReturning(value: unknown) {
  const create = jest.fn().mockResolvedValue(value);
  return { client: { responses: { create } } as unknown as Parameters<typeof searchPublicCompanyProfile>[0], create };
}

const NOW = new Date('2026-11-20T00:00:00Z');

describe('公開情報の検索（企業情報）', () => {
  it('出典のある行だけを事実として返す', async () => {
    const { client } = clientReturning(
      responseWith([
        { text: '会社名: 株式会社サンプル', url: 'https://sample.co.jp/company', title: '会社概要' },
        { text: '所在地: 東京都千代田区（推測）' },
        { text: '業種: 機械', url: 'https://sample.co.jp/company', title: '会社概要' },
      ]),
    );
    const r = await searchPublicCompanyProfile(client, '株式会社サンプル', NOW);
    expect(r.status).toBe('completed');
    expect(r.confirmedOn).toBe('2026-11-20');
    expect(r.facts.map((f) => f.text)).toEqual(['会社名: 株式会社サンプル', '業種: 機械']);
    expect(r.facts[0].sources).toEqual([{ title: '会社概要', url: 'https://sample.co.jp/company' }]);
  });

  it('送るのは会社名だけで、検索は一度だけ行う', async () => {
    const { client, create } = clientReturning(responseWith([{ text: '会社名: 株式会社サンプル', url: 'https://sample.co.jp/', title: '会社概要' }]));
    await searchPublicCompanyProfile(client, '株式会社サンプル', NOW);
    expect(create).toHaveBeenCalledTimes(1);
    const [body, options] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(body.input).toBe('対象の会社名: 株式会社サンプル');
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.store).toBe(false);
    expect(String(body.instructions)).toContain('会社名、所在地、業種、従業員数');
    expect(options).toEqual({ timeout: 25_000, maxRetries: 0 });
  });

  it('出典つきの行が無ければ no_results', async () => {
    const { client } = clientReturning(responseWith([{ text: '会社名: 株式会社サンプル' }]));
    expect((await searchPublicCompanyProfile(client, '株式会社サンプル', NOW)).status).toBe('no_results');
  });

  it('時間内に応答が無ければ timeout、APIの失敗は failed（再試行しない）', async () => {
    const hang = { responses: { create: jest.fn(() => new Promise(() => undefined)) } } as unknown as Parameters<typeof searchPublicCompanyProfile>[0];
    expect((await searchPublicCompanyProfile(hang, '株式会社サンプル', NOW, 10)).status).toBe('timeout');

    const rejected = Object.assign(new Error('rate'), { name: 'RateLimitError', status: 429 });
    const failing = { responses: { create: jest.fn().mockRejectedValue(rejected) } } as unknown as Parameters<typeof searchPublicCompanyProfile>[0];
    const r = await searchPublicCompanyProfile(failing, '株式会社サンプル', NOW);
    expect(r.status).toBe('failed');
    expect((failing.responses.create as unknown as jest.Mock).mock.calls.length).toBe(1);
  });
});

import { stripCitationMarkup } from './publicSearch';

describe('本文に混じった引用記法を除く（出典は保持する）', () => {
  it('引用のリンクとURLを除き、項目の値だけを残す', () => {
    const f = stripCitationMarkup({
      text: '会社名: サントリーホールディングス株式会社 ([suntory.co.jp](https://www.suntory.co.jp/company/overview/?ke=mn&utm_source=openai))',
      sources: [{ title: 'suntory.co.jp', url: 'https://www.suntory.co.jp/company/overview/?ke=mn' }],
      period: null,
      publishedOn: null,
      kind: null,
    });
    expect(f.text).toBe('会社名: サントリーホールディングス株式会社');
    expect(f.sources).toEqual([{ title: 'suntory.co.jp', url: 'https://www.suntory.co.jp/company/overview/?ke=mn' }]);
  });

  it('本文の語の後ろにある角括弧のリンクは、語だけを残す', () => {
    const f = stripCitationMarkup({ text: '所在地: [大阪府](https://example.co.jp/a)大阪市', sources: [], period: null, publishedOn: null, kind: null });
    expect(f.text).toBe('所在地: 大阪府大阪市');
  });
});
