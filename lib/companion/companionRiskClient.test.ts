import { decodeRiskStored, encodeRiskStored, requestRiskReview, riskReviewBody, type RiskReviewResult } from './companionRiskClient';

const token = async () => 'token-1';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

const result = (patch: Partial<RiskReviewResult>): RiskReviewResult => ({
  status: 'ISSUES',
  facts: [],
  text: null,
  serious: false,
  coverage: [],
  ...patch,
});

describe('経営点検の依頼', () => {
  it('事実・所見・重大さ・状態を、サーバーの応答から読む（認証付きで送る）', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ status: 'ISSUES', facts: ['- 2027年度：不足'], text: '仮説：回収の遅れ', serious: true, coverage: [] }),
    );
    const res = await requestRiskReview({ companyId: 'co-a', strategyId: 'st-a', getAccessToken: token, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ status: 'ISSUES', facts: ['- 2027年度：不足'], text: '仮説：回収の遅れ', serious: true, coverage: [] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/companion/risk-review');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    expect(JSON.parse(String(init.body))).toEqual({ companyId: 'co-a', strategyId: 'st-a' });
  });

  it('重大さの記載が無い応答は、重大でない扱いにする', async () => {
    const res = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({ facts: ['- 事実'], text: null })) as unknown as typeof fetch,
    });
    expect(res?.serious).toBe(false);
  });

  it('状態の記載が無い古い応答は、事実と判断材料から状態を決める', async () => {
    const withFacts = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({ facts: ['- 事実'], text: null })) as unknown as typeof fetch,
    });
    expect(withFacts?.status).toBe('ISSUES');
    const onlyCoverage = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({ facts: [], text: null, coverage: ['- 資金繰り：未登録'] })) as unknown as typeof fetch,
    });
    expect(onlyCoverage?.status).toBe('INSUFFICIENT');
  });

  it('未ログイン・停止中は、依頼しないため null を返す', async () => {
    const noToken = await requestRiskReview({ companyId: 'c', strategyId: 's', getAccessToken: async () => null, fetchImpl: jest.fn() as unknown as typeof fetch });
    expect(noToken).toBeNull();
    const disabled = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({ error: 'companion_disabled' }, false, 503)) as unknown as typeof fetch,
    });
    expect(disabled).toBeNull();
  });

  it('点検の処理に失敗した応答・形の違う応答・通信の失敗は、FAILEDとして示す（案内を黙って消さない）', async () => {
    const failed = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({}, false, 500)) as unknown as typeof fetch,
    });
    expect(failed?.status).toBe('FAILED');
    const wrongShape = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => jsonResponse({ facts: 'x' })) as unknown as typeof fetch,
    });
    expect(wrongShape?.status).toBe('FAILED');
    const thrown = await requestRiskReview({
      companyId: 'c',
      strategyId: 's',
      getAccessToken: token,
      fetchImpl: (async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
    });
    expect(thrown?.status).toBe('FAILED');
  });

  it('AIの所見が無くても、事実は表示し、所見が無いことを明記する', () => {
    const body = riskReviewBody(result({ facts: ['- 2027年度：不足'], text: null }));
    expect(body.startsWith('事実（保存済みデータの計算結果）')).toBe(true);
    expect(body).toContain('- 2027年度：不足');
    expect(body).toContain('AIの所見は取得できませんでした');
  });

  it('本文の末尾に、点検していない範囲（費用の計画と実績、会社全体のKR）を必ず添える', () => {
    const body = riskReviewBody(result({ facts: ['- 事実'], text: '仮説：x' }));
    expect(body).toContain('点検していない範囲：費用（OPEX・コスト削減・追加費用）の計画と実績、会社全体のKR');
    expect(body.indexOf('点検していない範囲')).toBeGreaterThan(body.indexOf('仮説：x'));
  });

  it('AIの見出し記号（###・**）は、画面に生で出さない', () => {
    const body = riskReviewBody(result({ facts: ['- 事実'], text: '### 仮説\n**2026年度**は不足の可能性があります。' }));
    expect(body).toContain('仮説\n2026年度は不足の可能性があります。');
    expect(body).not.toContain('###');
    expect(body).not.toContain('**');
  });

  it('判断できなかった項目は、理由別に、点検していない範囲より前に示す', () => {
    const coverage = ['- 資金繰り：取得失敗（保存済みの資金計画を読めませんでした）', '- KRの期限：判断材料不足（期限が未入力のKRが2件あり、期限超過は判定していません）'];
    const body = riskReviewBody(result({ facts: ['- 事実'], text: '仮説：x', coverage }));
    expect(body).toContain('判断できなかった項目（理由別）');
    expect(body).toContain(coverage[0]);
    expect(body.indexOf('判断できなかった項目')).toBeLessThan(body.indexOf('点検していない範囲'));
    expect(riskReviewBody(result({ facts: ['- 事実'], text: '仮説：x' }))).not.toContain('判断できなかった項目');
  });

  it('事実が0件で点検できた範囲に問題がなければ、問題なしと定型文で示し、AIの所見は含めない', () => {
    const body = riskReviewBody(result({ status: 'NO_ISSUE' }));
    expect(body).toContain('点検できた範囲では、問題は検出されませんでした');
    expect(body).not.toContain('仮説');
    expect(body).toContain('点検していない範囲');
  });

  it('事実が0件で判断材料が不足していれば、不足の理由を並べ、結論を出さない', () => {
    const coverage = ['- 資金繰り：判断材料不足（新規借入が未入力です）'];
    const body = riskReviewBody(result({ status: 'INSUFFICIENT', coverage }));
    expect(body).toContain('判断材料が不足している項目があるため、経営点検の結論は出せません');
    expect(body).toContain(coverage[0]);
    expect(body).not.toContain('問題は検出されませんでした');
  });

  it('点検に失敗したときは、失敗と次の点検の時期を示し、所見や事実は作らない', () => {
    const body = riskReviewBody(result({ status: 'FAILED' }));
    expect(body).toContain('経営点検の処理に失敗したため');
    expect(body).not.toContain('事実（保存済みデータの計算結果）');
  });

  it('保存した所見は、状態・重大さ・本文を元に戻せる。壊れた保存内容は読まない', () => {
    const raw = encodeRiskStored({ status: 'ISSUES', serious: true, body: '本文' });
    expect(decodeRiskStored(raw)).toEqual({ status: 'ISSUES', serious: true, body: '本文' });
    expect(decodeRiskStored(null)).toBeNull();
    expect(decodeRiskStored('not json')).toBeNull();
    expect(decodeRiskStored(JSON.stringify({ serious: true, body: '本文' }))).toBeNull();
    expect(decodeRiskStored(JSON.stringify({ status: 'UNKNOWN', body: '本文' }))).toBeNull();
  });
});
