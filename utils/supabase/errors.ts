/* ========================================================================
 * Supabase / PostgREST エラー抽出・判定ユーティリティ（堅牢版）
 * ===================================================================== */
export type ExtractedPgError = {
  status?: number;
  code: string;
  message: string;
  details: string;
  hint?: string;
  name?: string;
  stack?: string;
};

/* ------------------------- internal helpers ------------------------- */
function toStringSafe(v: unknown, max = 2000): string {
  if (v == null) return '';
  let s = '';
  if (typeof v === 'string') {
    s = v;
  } else {
    try {
      s = JSON.stringify(v);
    } catch {
      try {
        s = String(v);
      } catch {
        s = '';
      }
    }
  }
  if (s.length > max) s = s.slice(0, max) + '…(+trunc)';
  return s;
}

function peel(e: any): any {
  if (!e) return e;

  // よくあるラップ構造を先に剥がす（具体→抽象）
  if (e?.error) return e.error;
  if (e?.res?.error) return e.res.error;
  if (e?.err) return e.err;
  if (e?.cause?.error) return e.cause.error;

  // supabase-js/storage などが返すことがある
  if (e?.error_message) return e; // 文字列だけでなく併存することがあるので e 自体を生かす
  if (e?.error_description) return e;

  // axios 風
  if (e?.response?.data?.error) return e.response.data.error;
  if (e?.response?.data) return e.response.data;

  // supabase-js PostgrestError 的
  if (e?.data?.error) return e.data.error;
  if (e?.data) return e.data;

  // fetch Response は最後（中身の読み出しは別ロジックで）
  if (typeof Response !== 'undefined' && e instanceof Response) return e;

  return e;
}

function pickFirst<T>(...vals: T[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}

/* ------------------------- core extractor --------------------------- */
export function debugExtractPostgrest(err: unknown): ExtractedPgError {
  const e0: any = err ?? {};
  const e = peel(e0);

  // fetch Response の場合（PostgREST のエラー JSON を抱えていることがある）
  if (typeof Response !== 'undefined' && e instanceof Response) {
    const status = e.status;

    // statusText だけでは乏しいので、可能なら body を同期的に拾う代替手段を試みる：
    // ただしここでは副作用を避け、他の経路（peel 済オブジェクト）を主に使う方針。
    const code = '';
    const message = e.statusText || '';
    const details = e.statusText || '';
    return { status, code, message, details };
  }

  // PostgrestError に多いフィールド系
  const status: number | undefined = pickFirst(
    e0?.status,
    e?.status,
    e0?.response?.status,
    e?.response?.status,
    typeof e?.code === 'number' ? e?.code : undefined
  );

  const codeRaw = pickFirst(
    e?.code,
    e0?.code,
    e?.error_code,
    e0?.error_code,
    e?.postgres_code,
    e0?.postgres_code,
    e?.name,
    e0?.name
  );

  const messageRaw = pickFirst(
    e?.message,
    e0?.message,
    e?.error_description,
    e0?.error_description,
    e?.statusText,
    e0?.statusText,
    e?.hint,
    e0?.hint,
    e?.error_message,
    e0?.error_message
  );

  const detailsRaw = pickFirst(
    e?.details,
    e0?.details,
    e?.detail,
    e0?.detail,
    e?.response?.data,
    e0?.response?.data,
    e?.body,
    e0?.body
  );

  const hintRaw = pickFirst(e?.hint, e0?.hint);

  const name = toStringSafe(pickFirst(e?.name, e0?.name, ''), 200);
  const stack = toStringSafe(pickFirst(e?.stack, e0?.stack, ''), 2000);

  const out: ExtractedPgError = {
    status,
    code: toStringSafe(codeRaw, 200),
    message: toStringSafe(messageRaw, 1000),
    details: toStringSafe(detailsRaw, 1500),
    hint: hintRaw ? toStringSafe(hintRaw, 500) : undefined,
    name: name || undefined,
    stack: stack || undefined,
  };

  if (!out.code && !out.message && !out.details) {
    out.message = toStringSafe(err, 1000);
  }

  return out;
}

/* --------------------- supporting utilities --------------------- */
export function exposeError(err: any): Record<string, any> {
  if (!err) return { message: 'unknown', raw: err };
  try {
    const names = Object.getOwnPropertyNames(err);
    const out: Record<string, any> = {};
    for (const k of names) out[k] = (err as any)[k];
    return out;
  } catch {
    return { message: String(err) };
  }
}

export function formatPgError(i: ExtractedPgError): string {
  const s = i.status != null ? `status=${i.status}` : '';
  const c = i.code ? `code=${i.code}` : '';
  const m = i.message ? `msg=${i.message}` : '';
  const d = i.details ? `details=${i.details}` : '';
  return [s, c, m, d].filter(Boolean).join(' | ');
}

/* -------------------------- predicates --------------------------- */
export function isRlsDenied(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const text = `${i.message} ${i.details}`.toLowerCase();
  return (
    i.status === 401 ||
    i.status === 403 ||
    i.code === '42501' || // insufficient_privilege
    text.includes('row level security') ||
    text.includes('permission denied')
  );
}

export function isInvalidJsonSyntax(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const text = `${i.message} ${i.details}`.toLowerCase();

  // 22P02: invalid_text_representation（JSON 以外でも出るが最頻）
  const patterns = [
    'invalid input syntax for type json',
    'invalid input syntax for type jsonb',
    'invalid input syntax for type',
    'json parse',
    'unexpected token',
  ];

  return (
    i.code === '22P02' ||
    patterns.some((p) => text.includes(p))
  );
}

export function isUniqueViolation(err: unknown): boolean {
  return debugExtractPostgrest(err).code === '23505';
}

export function isForeignKeyViolation(err: unknown): boolean {
  return debugExtractPostgrest(err).code === '23503';
}

export function isNotNullViolation(err: unknown): boolean {
  return debugExtractPostgrest(err).code === '23502';
}

export function isCheckViolation(err: unknown): boolean {
  return debugExtractPostgrest(err).code === '23514';
}

export function isUndefinedColumn(err: unknown): boolean {
  return debugExtractPostgrest(err).code === '42703';
}

export function isConflict(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 409 || i.code === '23505';
}

export function isBadRequest(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  // 22P02 は「不正な文字列→型変換失敗」の一般例（JSON だけでなく数値/UUID等でも）
  return i.status === 400 || i.code === '22P02';
}

export function isTimeoutOrNetwork(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const txt = `${i.message} ${i.details}`.toLowerCase();
  return (
    txt.includes('timeout') ||
    txt.includes('timed out') ||
    txt.includes('network') ||
    txt.includes('fetch') ||
    txt.includes('aborted') ||
    txt.includes('failed to fetch') ||
    txt.includes('request was blocked') ||
    txt.includes('ecconnreset') ||
    txt.includes('econnrefused')
  );
}

/* ---- 追加の便利判定 ----------------------- */
export function isRateLimited(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const t = `${i.message} ${i.details}`.toLowerCase();
  return i.status === 429 || t.includes('rate limit');
}
export const isTooManyRequests = isRateLimited;

export function isPayloadTooLarge(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const t = `${i.message} ${i.details}`.toLowerCase();
  return i.status === 413 || t.includes('payload too large') || t.includes('entity too large');
}

export function hasPgCode(err: unknown): boolean {
  return !!debugExtractPostgrest(err).code;
}

/** PostgREST: No rows found (select.maybeSingle の典型) */
export function isNoRows(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.code === 'PGRST116' || /no rows/i.test(`${i.message} ${i.details}`);
}

/* -------------------------- convenience --------------------------- */
export function printErrorCompact(prefix: string, err: unknown): ExtractedPgError {
  const ex = debugExtractPostgrest(err);
  console.error(prefix, formatPgError(ex), { extracted: ex, exposed: exposeError(err) });
  return ex;
}
