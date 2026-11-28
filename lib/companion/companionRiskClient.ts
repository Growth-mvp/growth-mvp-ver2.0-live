/* 経営点検を依頼する。事実が無ければAIは呼ばれない。失敗しても自動では再依頼しない。 */
import { AI_NOTE, NOT_CHECKED_NOTE, STATUS_LEAD, type AiState, type RiskStatus } from './companionRisk';
import { jstDateTimeLabel } from './jst';

export type RiskReviewRequest = {
  companyId: string;
  strategyId: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export type RiskReviewResult = {
  status: RiskStatus;
  facts: string[];
  text: string | null;
  serious: boolean;
  coverage: string[];
  aiState?: AiState;
  checkedAt?: string;
};

const FAILED: RiskReviewResult = { status: 'FAILED', facts: [], text: null, serious: false, coverage: [] };

/** null は依頼しない（停止中・未ログイン）。FAILED は依頼したが点検できなかった */
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
    if (res.status === 503) return null;
    if (!res.ok) return FAILED;
    const raw = await res.text();
    const data = raw
      ? (JSON.parse(raw) as {
          status?: unknown;
          facts?: unknown;
          text?: unknown;
          serious?: unknown;
          coverage?: unknown;
          aiState?: unknown;
          checkedAt?: unknown;
        })
      : null;
    if (!data || !Array.isArray(data.facts)) return FAILED;
    const facts = data.facts.filter((f): f is string => typeof f === 'string');
    const coverage = Array.isArray(data.coverage) ? data.coverage.filter((c): c is string => typeof c === 'string') : [];
    const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : null;
    const status = isStatus(data.status)
      ? data.status
      : facts.length > 0
        ? 'ISSUES'
        : coverage.length > 0
          ? 'INSUFFICIENT'
          : 'NO_ISSUE';
    const aiState = isAiState(data.aiState) ? data.aiState : undefined;
    const checkedAt = typeof data.checkedAt === 'string' ? data.checkedAt : undefined;
    return { status, facts, text, serious: data.serious === true, coverage, aiState, checkedAt };
  } catch {
    return FAILED;
  }
}

const AI_STATES: readonly AiState[] = [
  'NOT_NEEDED',
  'GENERATED',
  'REUSED',
  'IN_PROGRESS',
  'FAILED_TODAY',
  'STALE',
  'OTHER_STRATEGY',
  'UNAVAILABLE',
  'FAILED',
];

function isAiState(v: unknown): v is AiState {
  return AI_STATES.includes(v as AiState);
}

function isStatus(v: unknown): v is RiskStatus {
  return v === 'ISSUES' || v === 'NO_ISSUE' || v === 'INSUFFICIENT' || v === 'FAILED';
}

/** 保存する点検結果。AI所見が作成中（IN_PROGRESS）の時は、開き直した時に再取得する */
export type StoredRisk = { status: RiskStatus; serious: boolean; body: string; aiState: AiState };

export function encodeRiskStored(v: StoredRisk): string {
  return JSON.stringify(v);
}

export function decodeRiskStored(raw: string | null): StoredRisk | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { status?: unknown; serious?: unknown; body?: unknown; aiState?: unknown };
    if (typeof v.body !== 'string' || !isStatus(v.status) || !isAiState(v.aiState)) return null;
    return { status: v.status, serious: v.serious === true, body: v.body, aiState: v.aiState };
  } catch {
    return null;
  }
}

/** 表示は本文をそのまま出すため、見出しと太字の記号だけを外す（文の内容は変えない） */
function plainText(text: string): string {
  return text.replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1');
}

/** 点検日時を先頭に示す。以後のデータ更新で結果が古くなりうることを、利用者が判断できるようにする */
function checkedLineOf(result: RiskReviewResult): string[] {
  const when = jstDateTimeLabel(result.checkedAt);
  if (!when) return [];
  return [
    `点検日時：${when}（この結果は、その時点の保存済みデータに基づきます。その後にデータを更新した場合は、「最新の点検を確認」で再点検できます）`,
    '',
  ];
}

/** 事実（プログラムの計算結果）を先に示し、AIの所見は仮説として後ろに続ける。点検していない範囲は必ず添える */
export function riskReviewBody(result: RiskReviewResult): string {
  const head = checkedLineOf(result);
  if (result.status === 'FAILED') return [...head, STATUS_LEAD.FAILED].join('\n');
  if (result.status !== 'ISSUES') {
    const lines = [...head, STATUS_LEAD[result.status]];
    if (result.coverage.length > 0) lines.push('', '判断できなかった項目（理由別）', ...result.coverage);
    lines.push('', NOT_CHECKED_NOTE);
    return lines.join('\n');
  }
  const lines = [...head, '事実（保存済みデータの計算結果）', ...result.facts, ''];
  lines.push(result.text ? plainText(result.text) : (result.aiState && AI_NOTE[result.aiState]) || AI_NOTE.FAILED || '');
  if (result.coverage.length > 0) lines.push('', '判断できなかった項目（理由別）', ...result.coverage);
  lines.push('', NOT_CHECKED_NOTE);
  return lines.join('\n');
}
