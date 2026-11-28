/* 経営点検を依頼する。事実が無ければAIは呼ばれない。失敗しても自動では再依頼しない。 */
import { AI_NOTE, NOT_CHECKED_NOTE, type AiState, type RiskStatus } from './companionRisk';
import { jstDateTimeLabel } from './jst';
import { riskSummaryOf } from './companionRiskSummary';

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
  summary?: string;
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
          summary?: unknown;
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
    const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : undefined;
    return { status, facts, text, serious: data.serious === true, coverage, aiState, checkedAt, summary };
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

/** 保存する点検結果。要約（summary）と詳細（detail）を持ち、AI所見が作成中（IN_PROGRESS）なら開き直した時に再取得する */
export type StoredRisk = {
  status: RiskStatus;
  serious: boolean;
  body: string;
  aiState: AiState;
  summary?: string;
  detail?: string;
  checkedLabel?: string;
};

export function encodeRiskStored(v: StoredRisk): string {
  return JSON.stringify(v);
}

export function decodeRiskStored(raw: string | null): StoredRisk | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.body !== 'string' || !isStatus(v.status) || !isAiState(v.aiState)) return null;
    const optional = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
    return {
      status: v.status,
      serious: v.serious === true,
      body: v.body,
      aiState: v.aiState,
      summary: optional('summary'),
      detail: optional('detail'),
      checkedLabel: optional('checkedLabel'),
    };
  } catch {
    return null;
  }
}

/** 表示は本文をそのまま出すため、見出しと太字の記号だけを外す（文の内容は変えない） */
function plainText(text: string): string {
  return text.replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1');
}

export type RiskView = {
  /** 初期表示の要約（会話形式・簡潔） */
  summary: string;
  /** 「経営点検の詳細を見る」で開く全文（事実・仮説・判断材料不足・点検していない範囲） */
  detail: string | null;
  /** 点検日時（常に表示する） */
  checkedLabel: string | null;
  /** 相談の送信内容に使う全文 */
  body: string;
};

function coverageBlock(coverage: string[]): string[] {
  return coverage.length > 0 ? ['', '判断できなかった項目（理由別）', ...coverage] : [];
}

/** 点検結果の表示用の内容。要約は決定的に作られ、詳細には全文を残す */
export function riskReviewView(result: RiskReviewResult): RiskView {
  const summary = result.summary ?? riskSummaryOf(result.status);
  const checkedAtLabel = jstDateTimeLabel(result.checkedAt);
  const checkedLabel = checkedAtLabel
    ? `点検日時：${checkedAtLabel}（保存済みデータの時点。データを更新した後は「最新の点検を確認」で再点検できます）`
    : null;

  let detail: string | null;
  if (result.status === 'FAILED') {
    detail = null;
  } else if (result.status !== 'ISSUES') {
    detail = [...coverageBlock(result.coverage), '', NOT_CHECKED_NOTE].join('\n').trim();
  } else {
    const ai = result.text ? plainText(result.text) : (result.aiState && AI_NOTE[result.aiState]) || AI_NOTE.FAILED || '';
    detail = [
      '事実（保存済みデータの計算結果）',
      ...result.facts,
      '',
      ai,
      ...coverageBlock(result.coverage),
      '',
      NOT_CHECKED_NOTE,
    ].join('\n');
  }

  const body = [checkedLabel, summary, detail].filter((s): s is string => Boolean(s)).join('\n\n');
  return { summary, detail, checkedLabel, body };
}

/** 相談の送信内容に使う全文（表示の要約と詳細をまとめたもの） */
export function riskReviewBody(result: RiskReviewResult): string {
  return riskReviewView(result).body;
}
