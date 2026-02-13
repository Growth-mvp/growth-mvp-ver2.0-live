// utils/authFetch.ts
'use client';

import { supabase } from '@/utils/supabase/client';

export type AuthFetchErrorCode = 'AUTH_NO_SESSION' | 'HTTP_ERROR';

export class AuthFetchError extends Error {
  code: AuthFetchErrorCode;
  status?: number;
  bodyText?: string;

  constructor(
    message: string,
    code: AuthFetchErrorCode,
    opts?: { status?: number; bodyText?: string }
  ) {
    super(message);
    this.name = 'AuthFetchError';
    this.code = code;
    this.status = opts?.status;
    this.bodyText = opts?.bodyText;
  }
}

async function getAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new AuthFetchError(
      `No session token available${error ? `: ${error.message}` : ''}`,
      'AUTH_NO_SESSION'
    );
  }
  return token;
}

/**
 * authFetch: Bearer token を自動付与して fetch する
 * - Bearer 必須 API（rbacGuard/getAuthUserIdFromBearer）にのみ使用
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();

  const headers = new Headers(init.headers || {});
  // 既に Authorization が明示されていれば尊重（上書きしない）
  if (!headers.get('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });

  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      bodyText = '';
    }
    throw new AuthFetchError(
      `HTTP error: ${res.status} ${res.statusText}`,
      'HTTP_ERROR',
      { status: res.status, bodyText }
    );
  }

  return res;
}

/**
 * JSON前提の便利関数（使う側の記述量を減らす）
 */
export async function authFetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(init.headers || {});
  // json を渡されたら body を作る
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
    body = JSON.stringify(init.json);
  }

  const res = await authFetch(input, { ...init, headers, body });
  return (await res.json()) as T;
}
