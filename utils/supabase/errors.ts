/* ========================================================================
 * Supabase / PostgREST エラー抽出・判定ユーティリティ（堅牢版）
 * ===================================================================== */
export type ExtractedPgError = {
  status?: number;
  code: string;
  message: string;
  details: string;
  name?: string;
  stack?: string;
};

/* ------------------------- internal helpers ------------------------- */
function toStringSafe(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    try {
      return String(v);
    } catch {
      return '';
    }
  }
}

function peel(e: any): any {
  if (!e) return e;
  if (e?.error) return e.error;
  if (e?.res?.error) return e.res.error;
  if (e?.err) return e.err;
  if (e?.cause?.error) return e.cause.error;
  if (e?.error_message) return e.error_message; // ✅ 追加
  if (e?.response?.data) return e.response.data;
  if (e?.data?.error) return e.data.error;
  if (e?.data) return e.data;
  if (typeof Response !== 'undefined' && e instanceof Response) return e;
  return e;
}

/* ------------------------- core extractor --------------------------- */
export function debugExtractPostgrest(err: unknown): ExtractedPgError {
  const e0: any = err ?? {};
  const e = peel(e0);

  if (typeof Response !== 'undefined' && e instanceof Response) {
    const status = e.status;
    const code = '';
    const message = e.statusText || '';
    const details = e.statusText || ''; // ✅ fallback
    return { status, code, message, details };
  }

  const status: number | undefined =
    e0?.status ??
    e?.status ??
    e0?.response?.status ??
    e?.response?.status ??
    (typeof e?.code === 'number' ? e.code : undefined);

  const codeRaw =
    e?.code ??
    e0?.code ??
    e?.error_code ??
    e0?.error_code ??
    e?.postgres_code ??
    e0?.postgres_code ??
    e?.name ??
    e0?.name ??
    '';

  const messageRaw =
    e?.message ??
    e0?.message ??
    e?.error_description ??
    e0?.error_description ??
    e?.statusText ??
    e0?.statusText ??
    e?.hint ??
    e0?.hint ??
    '';

  const detailsRaw =
    e?.details ??
    e0?.details ??
    e?.response?.data ??
    e0?.response?.data ??
    e?.body ??
    e0?.body ??
    e?.detail ??
    e0?.detail ??
    '';

  const name = toStringSafe(e?.name ?? e0?.name ?? '');
  const stack = toStringSafe(e?.stack ?? e0?.stack ?? '');

  const out: ExtractedPgError = {
    status,
    code: toStringSafe(codeRaw),
    message: toStringSafe(messageRaw),
    details: toStringSafe(detailsRaw),
    name: name || undefined,
    stack: stack || undefined,
  };

  if (!out.code && !out.message && !out.details) {
    out.message = toStringSafe(err);
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
    i.code === '42501' ||
    text.includes('row level security') ||
    text.includes('permission denied')
  );
}

export function isInvalidJsonSyntax(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const text = `${i.message} ${i.details}`.toLowerCase();
  return (
    i.code === '22P02' ||
    text.includes('invalid input syntax for type') ||
    text.includes('json')
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
  return debugExtractPostgrest(err).status === 409;
}

export function isAuthError(err: unknown): boolean {
  return debugExtractPostgrest(err).status === 401;
}

export function isPermissionDenied(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 403 || i.code === '42501';
}

export function isBadRequest(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 400 || i.code === '22P02'; // ✅ 拡張
}

export function isTimeoutOrNetwork(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const txt = `${i.message} ${i.details}`.toLowerCase();
  return (
    txt.includes('timeout') ||
    txt.includes('network') ||
    txt.includes('fetch') ||
    txt.includes('aborted') ||
    txt.includes('failed to fetch')
  );
}

/* ---- 追加の便利判定 ----------------------- */
export function isRateLimited(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 429 || `${i.message} ${i.details}`.toLowerCase().includes('rate limit');
}

export const isTooManyRequests = isRateLimited;

export function isPayloadTooLarge(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 413 || `${i.message} ${i.details}`.toLowerCase().includes('payload too large');
}

export function hasPgCode(err: unknown): boolean {
  return !!debugExtractPostgrest(err).code;
}

/* -------------------------- convenience --------------------------- */
export function printErrorCompact(prefix: string, err: unknown): ExtractedPgError {
  const ex = debugExtractPostgrest(err);
  console.error(prefix, formatPgError(ex), { extracted: ex, exposed: exposeError(err) });
  return ex;
}
