/* 経営支援の助言を、節目ごとに一度だけ依頼する（チャットの履歴には入れない）。
 * 失敗しても自動では再依頼しない。応答は本文だけを返し、画面側で表示する。 */

import type { Milestone } from './companionMilestones';
import { buildMilestonePrompt } from './companionAdvice';

export type AdviceRequest = {
  milestone: Milestone;
  userId: string;
  companyId: string;
  strategyId: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

/** 応答の本文を返す。取得できなければ null（呼び出し側は案内を出さない） */
export async function requestMilestoneAdvice(req: AdviceRequest): Promise<string | null> {
  const doFetch = req.fetchImpl ?? fetch;
  try {
    const token = await req.getAccessToken();
    if (!token) return null;
    const res = await doFetch('/api/ask-ceo-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
      body: JSON.stringify({
        userId: req.userId,
        strategyId: req.strategyId,
        companyId: req.companyId,
        messages: [{ role: 'user', content: buildMilestonePrompt(req.milestone) }],
        meta: { mode: 'facilitator', output: 'text', companion: { milestone: req.milestone } },
      }),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const data = raw ? (JSON.parse(raw) as { content?: unknown; reply?: { content?: unknown } }) : null;
    const content = typeof data?.content === 'string' ? data.content : typeof data?.reply?.content === 'string' ? data.reply.content : '';
    return content.trim() ? content.trim() : null;
  } catch {
    return null;
  }
}
