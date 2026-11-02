export type AskRole = 'user' | 'assistant';
export type AskMessage = { role: AskRole; content: string };

const ALLOWED_ROLES: ReadonlySet<string> = new Set<AskRole>(['user', 'assistant']);
const MAX_HISTORY_MESSAGES = 12;

export function sanitizeAskMessages(input: unknown): AskMessage[] {
  if (!Array.isArray(input)) return [];
  const out: AskMessage[] = [];
  for (const m of input) {
    if (typeof m !== 'object' || m === null) continue;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) continue;
    if (typeof content !== 'string' || content.trim().length === 0) continue;
    out.push({ role: role as AskRole, content });
  }
  return out.slice(-MAX_HISTORY_MESSAGES);
}

export type AskCompanyGate = { ok: true } | { ok: false; message: string };

export function evaluateAskCompanyGate(
  activeCompanyId: string | null,
  storeCompanyId: string | null | undefined
): AskCompanyGate {
  if (!activeCompanyId) {
    return { ok: false, message: '企業情報を確認できません。画面を再読み込みしてください。' };
  }
  if (storeCompanyId !== activeCompanyId) {
    return {
      ok: false,
      message: '企業を切り替えています。読み込みが完了してから、もう一度送信してください。',
    };
  }
  return { ok: true };
}

export type AskFailure =
  | { kind: 'http'; status: number }
  | { kind: 'network' }
  | { kind: 'timeout' };

export class AskFailureError extends Error {
  readonly failure: AskFailure;

  constructor(failure: AskFailure) {
    super(`ask-ceo-agent failed: ${failure.kind}`);
    this.name = 'AskFailureError';
    this.failure = failure;
  }
}

export function classifyAskError(e: unknown): AskFailure {
  if (e instanceof AskFailureError) return e.failure;
  if (e instanceof Error && e.name === 'AbortError') return { kind: 'timeout' };
  return { kind: 'network' };
}

export function describeAskFailure(failure: AskFailure): string {
  if (failure.kind === 'timeout') {
    return '応答がタイムアウトしました。もう一度お試しください。';
  }
  if (failure.kind === 'network') {
    return '通信できませんでした。ネットワーク接続を確認して、もう一度お試しください。';
  }
  switch (failure.status) {
    case 400:
      return '送信内容を処理できませんでした。画面を再読み込みしてから、もう一度お試しください。';
    case 401:
      return 'ログインの有効期限が切れています。再ログインしてください。';
    case 403:
      return 'この企業の情報にアクセスできません。企業を選び直してから、もう一度お試しください。';
    case 404:
      return '戦略データが見つかりません。画面を再読み込みしてください。';
    case 429:
      return '利用上限に達しました。しばらく待ってから、もう一度お試しください。';
    default:
      if (failure.status >= 500) {
        return 'サーバーで一時的なエラーが発生しました。しばらく待ってから、もう一度お試しください。';
      }
      return '応答を取得できませんでした。もう一度お試しください。';
  }
}
