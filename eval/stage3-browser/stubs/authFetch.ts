/* 検証用の通信部品：本番の認証（対話セッション）を使わず、検証用の利用者IDで送る */
export class AuthFetchError extends Error {
  status?: number;
  bodyText?: string;
  constructor(message: string, status?: number, bodyText?: string) {
    super(message);
    this.status = status;
    this.bodyText = bodyText;
  }
}

export async function authFetchJson<T>(input: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const user = (globalThis as unknown as { __USER?: string }).__USER ?? '';
  const res = await fetch(input, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer test:${user}` },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  const text = await res.text();
  if (!res.ok) throw new AuthFetchError(`HTTP ${res.status}`, res.status, text);
  return JSON.parse(text) as T;
}
