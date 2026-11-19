import { requestRiskReview, riskReviewBody } from './companionRiskClient';

const token = async () => 'token-1';

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) };
}

describe('経営点検の依頼', () => {
  it('事実と所見を、サーバーの応答から読む（認証付きで送る）', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ facts: ['- 2027年度：不足'], text: '仮説：資金の回収が遅れている可能性' }));
    const result = await requestRiskReview({ companyId: 'co-a', strategyId: 'st-a', getAccessToken: token, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ facts: ['- 2027年度：不足'], text: '仮説：資金の回収が遅れている可能性' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/companion/risk-review');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    expect(JSON.parse(String(init.body))).toEqual({ companyId: 'co-a', strategyId: 'st-a' });
  });

  it('失敗・認証なし・形の違う応答は、案内を出さないために null を返す', async () => {
    const noToken = await requestRiskReview({ companyId: 'c', strategyId: 's', getAccessToken: async () => null, fetchImpl: jest.fn() as unknown as typeof fetch });
    expect(noToken).toBeNull();
    const failed = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({}, false)) as unknown as typeof fetch,
    });
    expect(failed).toBeNull();
    const wrongShape = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({ facts: 'x' })) as unknown as typeof fetch,
    });
    expect(wrongShape).toBeNull();
  });

  it('AIの所見が無くても、事実は表示し、所見が無いことを明記する', () => {
    const body = riskReviewBody({ facts: ['- 2027年度：不足'], text: null });
    expect(body.startsWith('事実（保存済みデータの計算結果）')).toBe(true);
    expect(body).toContain('- 2027年度：不足');
    expect(body).toContain('AIの所見は取得できませんでした');
  });
});
