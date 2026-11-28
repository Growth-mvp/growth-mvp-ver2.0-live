/* 経営点検のAI呼び出しの実行枠（企業・日本時間の日付ごとに1件）と、当日の共通所見を扱う。
 * 実行枠の確保は、認証・所属・戦略の確認の後、AI呼び出しの前に行う。確保できなければAIを呼ばない。 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiskFact } from './companionRisk';
import { jstDateOf } from './jst';

const TABLE = 'companion_risk_claims';
const UNIQUE_VIOLATION = '23505';

/** 点検事実の指紋（SHA-256）。事実の本文が変わった時だけ値が変わる */
export function riskFingerprint(facts: RiskFact[]): string {
  return createHash('sha256')
    .update(facts.map((f) => f.text).join('\n'), 'utf8')
    .digest('hex');
}

export { jstDateOf };

export type ClaimKey = { companyId: string; strategyId: string; day: string; fingerprint: string };

type ClaimRow = {
  company_id: string;
  claim_date: string;
  strategy_id: string;
  facts_fingerprint: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  ai_finding: string | null;
};

export type BlockedState = 'IN_PROGRESS' | 'FAILED_TODAY' | 'STALE' | 'OTHER_STRATEGY' | 'UNAVAILABLE';

export type ClaimOutcome = { kind: 'WON' } | { kind: 'REUSE'; finding: string } | { kind: 'BLOCKED'; state: BlockedState };

const unavailable: ClaimOutcome = { kind: 'BLOCKED', state: 'UNAVAILABLE' };

/** 実行枠を確保する。一意制約により、同じ企業・同じ日付で成功するのは1件だけ。確保できなければ UNAVAILABLE */
export async function claimDailyRiskReview(admin: SupabaseClient, key: ClaimKey): Promise<ClaimOutcome> {
  try {
    const { error } = await admin.from(TABLE).insert({
      company_id: key.companyId,
      claim_date: key.day,
      strategy_id: key.strategyId,
      access_scope: 'COMPANY_MEMBER',
      facts_fingerprint: key.fingerprint,
      status: 'PENDING',
    });
    if (!error) return { kind: 'WON' };
    if (error.code !== UNIQUE_VIOLATION) return unavailable;

    const { data, error: readError } = await admin
      .from(TABLE)
      .select('*')
      .eq('company_id', key.companyId)
      .eq('claim_date', key.day)
      .maybeSingle();
    if (readError || !data) return unavailable;
    return judgeExisting(data as ClaimRow, key);
  } catch {
    return unavailable;
  }
}

function judgeExisting(row: ClaimRow, key: ClaimKey): ClaimOutcome {
  if (row.strategy_id.toLowerCase() !== key.strategyId.toLowerCase()) return { kind: 'BLOCKED', state: 'OTHER_STRATEGY' };
  if (row.facts_fingerprint !== key.fingerprint) return { kind: 'BLOCKED', state: 'STALE' };
  if (row.status === 'DONE' && row.ai_finding) return { kind: 'REUSE', finding: row.ai_finding };
  if (row.status === 'FAILED' || row.status === 'DONE') return { kind: 'BLOCKED', state: 'FAILED_TODAY' };
  return { kind: 'BLOCKED', state: 'IN_PROGRESS' };
}

/** 確保した実行枠の結果を書き戻す。PENDING の行だけを更新する（再試行はしない） */
export async function finishClaim(
  admin: SupabaseClient,
  key: ClaimKey,
  result: { status: 'DONE'; finding: string } | { status: 'FAILED' },
): Promise<boolean> {
  try {
    const { error } = await admin
      .from(TABLE)
      .update({
        status: result.status,
        ai_finding: result.status === 'DONE' ? result.finding : null,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', key.companyId)
      .eq('claim_date', key.day)
      .eq('facts_fingerprint', key.fingerprint)
      .eq('status', 'PENDING');
    return !error;
  } catch {
    return false;
  }
}
