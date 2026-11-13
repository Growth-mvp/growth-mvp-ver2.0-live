/* 再生成のプレビューの署名。利用者が「この案を使う」を押した時、その案がサーバーの生成結果で、
 * 対象（会社・戦略・プロジェクト）と内容が変わっていないことを確かめる。保存はせず、有効期限で切る。 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';

import type { PlanDocKey } from './planDocumentStore';

const TTL_MS = 30 * 60 * 1000;

type Claims = { key: PlanDocKey; draft: string; exp: number };

const digestOf = (draft: unknown): string => createHash('sha256').update(JSON.stringify(draft)).digest('hex');
const macOf = (secret: string, body: string): string => createHmac('sha256', secret).update(body).digest('base64url');

export function signPreview(secret: string, key: PlanDocKey, draft: Record<string, unknown>, nowMs: number): string {
  const claims: Claims = { key, draft: digestOf(draft), exp: nowMs + TTL_MS };
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${body}.${macOf(secret, body)}`;
}

export function verifyPreview(
  secret: string,
  token: string,
  key: PlanDocKey,
  draft: Record<string, unknown>,
  nowMs: number
): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'utf8');
  const expected = Buffer.from(macOf(secret, body), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims;
  } catch {
    return false;
  }
  return (
    claims.key?.companyId === key.companyId &&
    claims.key?.strategyId === key.strategyId &&
    claims.key?.projectId === key.projectId &&
    claims.draft === digestOf(draft) &&
    claims.exp > nowMs
  );
}
