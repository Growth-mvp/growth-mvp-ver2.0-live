import * as dns from 'dns';
import * as net from 'net';
import { contentTokensOf, numbersIn } from './qualityCheck';

export type BodyCheck = 'matched' | 'not_matched' | 'unavailable';
export type BodyCheckStats = { attempted: number; matched: number; notMatched: number; unavailable: number };

const MIN_BODY_CHARS = 200;
const FETCH_TIMEOUT_MS = 4_000;
const MAX_BYTES = 400_000;
const MAX_SOURCES = 20;
const CONCURRENCY = 6;

export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (net.isIPv6(v)) {
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice('::ffff:'.length));
    if (/^f[cd]/.test(v)) return true;
    if (/^fe[89ab]/.test(v)) return true;
    return false;
  }
  if (!net.isIPv4(v)) return true;
  const [a, b] = v.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolve: Resolver = async (host) =>
  (await dns.promises.lookup(host, { all: true })).map((a) => a.address);

/** 本文を取りに行ってよい URL か。https・既定ポート・認証情報なし・公開アドレスだけを許す */
export async function assertPublicHttpsUrl(raw: string, resolve: Resolver = defaultResolve): Promise<void> {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error('unsafe_url');
  if (u.username || u.password) throw new Error('unsafe_url');
  if (u.port && u.port !== '443') throw new Error('unsafe_url');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('unsafe_url');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('unsafe_url');
    return;
  }
  const addresses = await resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error('unsafe_url');
}

const CHARSET_LABEL: Record<string, string> = {
  'shift_jis': 'shift_jis',
  'shift-jis': 'shift_jis',
  'sjis': 'shift_jis',
  'windows-31j': 'shift_jis',
  'x-sjis': 'shift_jis',
  'euc-jp': 'euc-jp',
  'utf-8': 'utf-8',
  'utf8': 'utf-8',
};

function charsetOf(contentType: string, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const ascii = new TextDecoder('latin1').decode(head.subarray(0, 2048));
  const fromMeta = /charset=["']?([\w-]+)/i.exec(ascii)?.[1];
  const label = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
  return CHARSET_LABEL[label] ?? 'utf-8';
}

/** HTML から本文の文字列だけを取り出す（スクリプト・スタイル・タグを除く） */
export function extractBodyText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 出典の本文を取得する。失敗・非テキスト・リダイレクト・上限超過は null（確認できなかった扱い） */
export async function fetchBodyText(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: FetchLike; resolve?: Resolver } = {}
): Promise<string | null> {
  try {
    await assertPublicHttpsUrl(url, opts.resolve);
  } catch {
    return null;
  }
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
      headers: { accept: 'text/html,text/plain;q=0.9', 'user-agent': 'GrowthShiftSourceCheck/1.0' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)/i.test(contentType) || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const html = new TextDecoder(charsetOf(contentType, bytes)).decode(bytes);
    const text = extractBodyText(html);
    return text.length >= MIN_BODY_CHARS ? text : null;
  } catch {
    return null;
  }
}

/**
 * 本文が、検索で得た主張を支えるか。数値はすべて本文に同じ表記であること、
 * 内容語は2つ（1つしか無い文は1つ）以上が本文にあること。語の一致だけの近似で、確認の証拠としては弱い。
 */
const squeeze = (s: string) => s.replace(/[,，\s]/g, '').toLowerCase();

export function bodySupportsStatement(statement: string, body: string): boolean {
  const nums = numbersIn(statement);
  const normalizedBody = squeeze(body);
  const normalizedStatement = squeeze(statement);
  if (nums.some((n) => !normalizedBody.includes(n))) return false;
  const tokens = [...contentTokensOf(normalizedStatement)];
  if (tokens.length === 0 && nums.length === 0) return false;
  const hits = tokens.filter((t) => normalizedBody.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}

export type CheckableSource = { index: number; url: string };
export type CheckedSource<T extends CheckableSource> = T & { contentVerified: boolean; bodyCheck: BodyCheck };

/**
 * 出典の本文を取得し、それぞれの出典に紐づく検索結果の主張が本文で支えられるかを見る。
 * 取得できない出典は unavailable とし、URL があるだけでは確認済みにしない。
 */
export async function checkSourceBodies<T extends CheckableSource>(args: {
  sources: readonly T[];
  findings: readonly { statement: string; sourceIndex: number }[];
  deadlineMs: number;
  fetchBody?: (url: string) => Promise<string | null>;
}): Promise<{ sources: CheckedSource<T>[]; stats: BodyCheckStats }> {
  const fetchBody = args.fetchBody ?? ((url: string) => fetchBodyText(url, { timeoutMs: Math.max(500, Math.min(FETCH_TIMEOUT_MS, args.deadlineMs - Date.now())) }));
  const stats: BodyCheckStats = { attempted: 0, matched: 0, notMatched: 0, unavailable: 0 };
  const results = new Map<number, BodyCheck>();
  const targets = args.sources.slice(0, MAX_SOURCES);
  for (const s of args.sources.slice(MAX_SOURCES)) results.set(s.index, 'unavailable');

  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const s = targets[next++];
      if (Date.now() >= args.deadlineMs) {
        results.set(s.index, 'unavailable');
        continue;
      }
      stats.attempted++;
      const text = await fetchBody(s.url);
      if (text === null) {
        results.set(s.index, 'unavailable');
        continue;
      }
      const own = args.findings.filter((f) => f.sourceIndex === s.index);
      const ok = own.some((f) => bodySupportsStatement(f.statement, text));
      results.set(s.index, ok ? 'matched' : 'not_matched');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));

  const sources = args.sources.map((s) => {
    const bodyCheck = results.get(s.index) ?? 'unavailable';
    if (bodyCheck === 'matched') stats.matched++;
    else if (bodyCheck === 'not_matched') stats.notMatched++;
    else stats.unavailable++;
    return { ...s, contentVerified: bodyCheck === 'matched', bodyCheck };
  });
  return { sources, stats };
}
