/* 経営点検を依頼する。事実が無ければ facts は空で、AIは呼ばれない。失敗しても自動では再依頼しない。 */

export type RiskReviewRequest = {
  companyId: string;
  strategyId: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export type RiskReviewResult = { facts: string[]; text: string | null };

/** 事実（プログラムの計算結果）を先に示し、AIの所見は仮説として後ろに続ける */
export function riskReviewBody(result: RiskReviewResult): string {
  const lines = ['事実（保存済みデータの計算結果）', ...result.facts, ''];
  lines.push(result.text ?? 'AIの所見は取得できませんでした。上の事実を確認してください。');
  return lines.join('\n');
}

export async function requestRiskReview(req: RiskReviewRequest): Promise<RiskReviewResult | null> {
  const doFetch = req.fetchImpl ?? fetch;
  try {
    const token = await req.getAccessToken();
    if (!token) return null;
    const res = await doFetch('/api/companion/risk-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
      body: JSON.stringify({ companyId: req.companyId, strategyId: req.strategyId }),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const data = raw ? (JSON.parse(raw) as { facts?: unknown; text?: unknown }) : null;
    if (!data || !Array.isArray(data.facts)) return null;
    const facts = data.facts.filter((f): f is string => typeof f === 'string');
    const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : null;
    return { facts, text };
  } catch {
    return null;
  }
}
