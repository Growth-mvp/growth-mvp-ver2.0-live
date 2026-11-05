import { CEO_SEARCH_TIMEOUT_MS, runPublicSearch } from './search';

type Client = Parameters<typeof runPublicSearch>[0];

const createMock = jest.fn();
const client = { responses: { create: (...args: unknown[]) => createMock(...args) } } as unknown as Client;

const SECRET_INPUT = 'SECRET-QUERY-マーカー';
const SECRET_KEY = 'sk-test-SECRET-KEY';

let logSpy: jest.SpyInstance;

beforeEach(() => {
  createMock.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  jest.useRealTimers();
});

const searchLogs = () => logSpy.mock.calls.filter((c) => c[0] === '[ceo_web_search]');
const eventNames = () => searchLogs().map((c) => c[1]);
const allLogText = () => JSON.stringify(logSpy.mock.calls);

function citedResponse(text: string) {
  return {
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text,
            annotations: [
              { type: 'url_citation', url: 'https://example.com/can', title: '缶統計', start_index: 0, end_index: text.length },
            ],
          },
        ],
      },
    ],
  };
}

describe('検索のタイムアウト', () => {
  it('既定のタイムアウトは25秒', () => {
    expect(CEO_SEARCH_TIMEOUT_MS).toBe(25_000);
  });

  it('SDKと自前の打ち切りに25秒を渡し、24.999秒では待ち続け、25秒で timeout にする', async () => {
    jest.useFakeTimers();
    createMock.mockReturnValue(new Promise(() => undefined));

    const pending = runPublicSearch(client, 'q');
    expect(createMock.mock.calls[0][1]).toEqual({ timeout: 25_000, maxRetries: 0 });

    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(24_999);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    const r = await pending;
    expect(r.status).toBe('timeout');
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('診断ログ', () => {
  it('開始・応答受信・結果の順に記録し、経過時間と出典数を含める', async () => {
    createMock.mockResolvedValue(citedResponse('金属缶の需要は横ばいだった。'));

    await runPublicSearch(client, 'q');

    expect(eventNames()).toEqual(['api_call_start', 'api_response_received', 'result']);
    expect(searchLogs()[0][2]).toEqual({ timeoutMs: 25_000 });
    const result = searchLogs()[2][2];
    expect(result).toMatchObject({ status: 'completed', sourceCount: 1 });
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('SDK のタイムアウトは APIConnectionTimeoutError として、自前の打ち切りは SearchTimeoutError として区別する', async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' }));
    await runPublicSearch(client, 'q');
    const sdkLog = searchLogs().find((c) => c[1] === 'api_error')?.[2];
    expect(sdkLog).toMatchObject({ status: 'timeout', errorName: 'APIConnectionTimeoutError' });

    createMock.mockReturnValueOnce(new Promise(() => undefined));
    await runPublicSearch(client, 'q', 20);
    const ownLog = searchLogs().filter((c) => c[1] === 'api_error').at(-1)?.[2];
    expect(ownLog).toMatchObject({ status: 'timeout', errorName: 'SearchTimeoutError' });
  });

  it('429 と その他の失敗を分類して記録する', async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429 }));
    await runPublicSearch(client, 'q');
    expect(searchLogs().find((c) => c[1] === 'api_error')?.[2]).toMatchObject({ status: 'rate_limited', errorStatus: 429 });

    logSpy.mockClear();
    createMock.mockRejectedValueOnce(new Error('network'));
    await runPublicSearch(client, 'q');
    expect(searchLogs().find((c) => c[1] === 'api_error')?.[2]).toMatchObject({ status: 'failed', errorName: 'Error' });
  });

  it('検索入力・APIキー・エラーメッセージ・出典の本文をログに出さない（成功時）', async () => {
    createMock.mockResolvedValue(citedResponse('金属缶の需要は横ばいだった。'));
    await runPublicSearch(client, `${SECRET_INPUT} ${SECRET_KEY}`);

    const text = allLogText();
    expect(text).not.toContain(SECRET_INPUT);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('金属缶の需要');
    expect(text).not.toContain('https://example.com/can');
  });

  it('検索入力・APIキー・エラーメッセージをログに出さない（失敗時）', async () => {
    createMock.mockRejectedValue(Object.assign(new Error(`bad request ${SECRET_INPUT} ${SECRET_KEY}`), { status: 400 }));
    await runPublicSearch(client, SECRET_INPUT);

    const text = allLogText();
    expect(text).not.toContain(SECRET_INPUT);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('bad request');
  });
});
