// /utils/supabase/errors.ts

/* ========================================================================
 * Supabase / PostgREST エラー抽出・判定ユーティリティ（堅牢版）
 * - 「❌ INSERT error: {}」の “空オブジェクト” 問題を回避し、code / message / details を必ず露出
 * - e.error / e.res.error / e.cause.error / response.data / Response など多彩な形を総なめ
 * - 代表的な Postgres エラーコードや HTTP ステータスのブール判定ヘルパを提供
 * ===================================================================== */

export type ExtractedPgError = {
  status?: number;   // HTTP ステータスや相当値（あれば）
  code: string;      // 例: '23505'(unique_violation), '22P02'(invalid_text_representation) など
  message: string;   // 人が読むメッセージ（statusText/hint/name なども包含）
  details: string;   // 本文・詳細（response.body/data 等）
  name?: string;     // Error.name（参考）
  stack?: string;    // Error.stack（参考）
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

/** ありがちなラップ形を順に剥がして中身に到達する */
function peel(e: any): any {
  if (!e) return e;
  if (e?.error) return e.error;
  if (e?.res?.error) return e.res.error;
  if (e?.err) return e.err;
  if (e?.cause?.error) return e.cause.error;

  // PostgREST / axios風 / fetchラッパ
  if (e?.response?.data) return e.response.data;
  if (e?.data?.error) return e.data.error;
  if (e?.data) return e.data;

  // Fetch API Response をそのまま渡されるケース
  if (typeof Response !== 'undefined' && e instanceof Response) return e;

  return e;
}

/* ------------------------- core extractor --------------------------- */

/** PostgREST/JS の多様なエラー形から主要情報だけ抜く（空オブジェクト対策込み） */
export function debugExtractPostgrest(err: unknown): ExtractedPgError {
  const e0: any = err ?? {};
  const e = peel(e0);

  // Response だった場合は素直に取り出す（可能ならテキスト/JSONを details に）
  if (typeof Response !== 'undefined' && e instanceof Response) {
    const status = e.status;
    const code = '';
    // 同期抽出のみ（非同期 read はここではやらない）
    const message = e.statusText || '';
    const details = '';
    return { status, code, message, details };
  }

  // ステータス候補
  const status: number | undefined =
    e0?.status ??
    e?.status ??
    e0?.response?.status ??
    e?.response?.status ??
    (typeof e?.code === 'number' ? e.code : undefined);

  // コード候補（PGコード/アプリ独自コード/Error.name）
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

  // メッセージ候補（statusText/hint/description系も包含）
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

  // 詳細候補（body/data/details系）
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

  // 参考情報（name/stack）
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

  // すべて空なら最後の保険
  if (!out.code && !out.message && !out.details) {
    out.message = toStringSafe(err);
  }

  return out;
}

/** 非列挙プロパティを含め **生** のエラー内容を丸見え化（デバッグ向け） */
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

/** ログ等で1行にまとめたい時のフォーマッタ */
export function formatPgError(i: ExtractedPgError): string {
  const s = i.status != null ? `status=${i.status}` : '';
  const c = i.code ? `code=${i.code}` : '';
  const m = i.message ? `msg=${i.message}` : '';
  const d = i.details ? `details=${i.details}` : '';
  return [s, c, m, d].filter(Boolean).join(' | ');
}

/* -------------------------- common checks -------------------------- */

/** RLS 拒否や権限不足（permission denied）系 */
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

/** JSON / 型不整合（主に 22P02 や json syntax） */
export function isInvalidJsonSyntax(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  const text = `${i.message} ${i.details}`.toLowerCase();
  return (
    i.code === '22P02' || // invalid_text_representation（JSON文字列ミス等でも出がち）
    text.includes('invalid input syntax for type') ||
    text.includes('json')
  );
}

/** 一意制約違反（unique_violation） */
export function isUniqueViolation(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.code === '23505';
}

/** 外部キー制約違反（foreign_key_violation） */
export function isForeignKeyViolation(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.code === '23503';
}

/** NOT NULL 制約違反（not_null_violation） */
export function isNotNullViolation(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.code === '23502';
}

/** CHECK 制約違反（check_violation） */
export function isCheckViolation(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.code === '23514';
}

/** 未定義カラム（undefined_column） */
export function isUndefinedColumn(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.code === '42703';
}

/** 競合（HTTP 409 / upsert 衝突など） */
export function isConflict(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 409;
}

/** 認証エラー（401） */
export function isAuthError(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 401;
}

/** 権限エラー（403 or 42501） */
export function isPermissionDenied(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 403 || i.code === '42501';
}

/** 不正リクエスト（400） */
export function isBadRequest(err: unknown): boolean {
  const i = debugExtractPostgrest(err);
  return i.status === 400;
}

/** タイムアウト/ネットワーク系の簡易判定 */
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

/* -------------------------- convenience --------------------------- */

/** 例: ログでまとめて使う */
export function printErrorCompact(prefix: string, err: unknown): ExtractedPgError {
  const ex = debugExtractPostgrest(err);
  // eslint-disable-next-line no-console
  console.error(prefix, formatPgError(ex), { extracted: ex, exposed: exposeError(err) });
  return ex;
}
