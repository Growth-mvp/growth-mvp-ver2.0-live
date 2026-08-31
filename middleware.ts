import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { extractSubFromJWTForRateLimit } from '@/lib/authUtils';

/**
 * Upstash ベースのレート制限 middleware
 *
 * 制限ルール：
 * 生成系: 認証済みユーザー 10 req/min, 50 req/day
 * 管理系: 認証済みユーザー 10-20 req/hour
 * 未認証またはトークン無効: IP単位で 30 req/min
 *
 * 認証：JWT の sub claim からユーザーを識別
 */

// Upstash 環境変数が設定されている場合のみ初期化
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

// Upstash が未設定の場合のログ
if (!redis) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[middleware] CRITICAL: Upstash Redis not configured in production. Rate limiting disabled.');
  } else {
    console.warn('[middleware] Upstash Redis not configured. Rate limiting disabled.');
  }
}

// レート制限インスタンス（複数のルールを同時に評価）
const createRateLimiter = (name: string, limit: number, window: Duration) =>
  redis
    ? new Ratelimit({
        redis,
        prefix: `ratelimit:${name}`,
        limiter: Ratelimit.slidingWindow(limit, window),
      })
    : null;

// レート制限定義
const rateLimiters = {
  // AI生成系: 1分単位
  generationPerMinute: createRateLimiter('gen_per_min', 10, '1 m'),
  // AI生成系: 1日単位
  generationPerDay: createRateLimiter('gen_per_day', 50, '24 h'),
  // 招待系: 1時間単位
  invitePerHour: createRateLimiter('invite_per_hour', 10, '1 h'),
  // メンバー追加: 1時間単位
  memberPerHour: createRateLimiter('member_per_hour', 20, '1 h'),
  // 未認証: 1分単位（IP）
  unauthPerMinute: createRateLimiter('unauth_per_min', 30, '1 m'),
};

// API パターンの分類
const AI_GENERATION_PATHS = [
  /^\/api\/generate/,
  /^\/api\/stage\d+\/generate/,
  /^\/api\/stage5\/assist-execution/,
  /^\/api\/recommend-/,
  /^\/api\/okr-from-exec/,
  /^\/api\/org-alignment\/.*\/generate/,
  /^\/api\/org-alignment\/generate/,
  /^\/api\/org-alignment\/intake/,
  /^\/api\/ask-ceo-agent/,
];

const MANAGEMENT_PATHS = [
  /^\/api\/invites/,
  /^\/api\/members/,
  /^\/api\/companies\/provision/,
];

const isAIGenerationAPI = (pathname: string) =>
  AI_GENERATION_PATHS.some(pattern => pattern.test(pathname));

const isManagementAPI = (pathname: string) =>
  MANAGEMENT_PATHS.some(pattern => pattern.test(pathname));


/**
 * Rate limit キー用の認証ユーザー識別
 * ⚠️ このメソッドは署名検証を行いません。rate limit キー生成用のみ
 * 認証が必要な場面では必ず API 側で署名検証済み関数を使用してください
 */
const getAuthenticatedUserKey = (req: NextRequest): string | null => {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;

  if (!token) {
    return null;
  }

  const sub = extractSubFromJWTForRateLimit(token);
  return sub ? `user:${sub}` : null;
};

const getClientIP = (req: NextRequest): string => {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    '0.0.0.0'
  );
};

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // 対象 API のみ処理
  const isAI = isAIGenerationAPI(pathname);
  const isManagement = isManagementAPI(pathname);

  if (!isAI && !isManagement) {
    return NextResponse.next();
  }

  // Redis / Upstash が未設定の場合はスキップ
  if (!redis) {
    return NextResponse.next();
  }

  // 認証済みユーザーキーを取得（JWT sub）
  // 失敗時は null、その場合は IP ベースの制限に落とす
  const userKey = getAuthenticatedUserKey(req);
  const clientIP = getClientIP(req);

  try {
    if (isAI) {
      // AI生成系: userId単位のレート制限（認証済みの場合）
      if (!userKey) {
        // 未認証またはトークン無効の場合は IP 単位で制限
        const ipLimit = rateLimiters.unauthPerMinute;
        if (ipLimit) {
          const ipKey = `ip:${clientIP}`;
          const ipResult = await ipLimit.limit(ipKey);
          if (!ipResult.success) {
            return NextResponse.json(
              { error: 'Too Many Requests' },
              { status: 429, headers: { 'RateLimit-Remaining': String(ipResult.remaining) } }
            );
          }
        }
      } else {
        // 認証済みの場合は複数ルール評価
        const minuteLimit = rateLimiters.generationPerMinute;
        const dayLimit = rateLimiters.generationPerDay;

        if (minuteLimit) {
          const minuteResult = await minuteLimit.limit(`${userKey}:min`);
          if (!minuteResult.success) {
            return NextResponse.json(
              { error: 'Too Many Requests' },
              { status: 429, headers: { 'RateLimit-Remaining': String(minuteResult.remaining) } }
            );
          }
        }

        if (dayLimit) {
          const dayResult = await dayLimit.limit(`${userKey}:day`);
          if (!dayResult.success) {
            return NextResponse.json(
              { error: 'Too Many Requests' },
              { status: 429, headers: { 'RateLimit-Remaining': String(dayResult.remaining) } }
            );
          }
        }
      }
    }

    if (isManagement) {
      // 管理系: 認証必須
      if (!userKey) {
        // 未認証またはトークン無効の場合は IP ベース制限に落とす
        const ipLimit = rateLimiters.unauthPerMinute;
        if (ipLimit) {
          const ipKey = `ip:${clientIP}`;
          const ipResult = await ipLimit.limit(ipKey);
          if (!ipResult.success) {
            return NextResponse.json(
              { error: 'Too Many Requests' },
              { status: 429, headers: { 'RateLimit-Remaining': String(ipResult.remaining) } }
            );
          }
        }
        // 認証なしのため API側で 401 を返させる（ここでは通す）
        return NextResponse.next();
      }

      // API 種別によって制限を分ける
      if (pathname.startsWith('/api/invites')) {
        const inviteLimit = rateLimiters.invitePerHour;
        if (inviteLimit) {
          const result = await inviteLimit.limit(`${userKey}:invite`);
          if (!result.success) {
            return NextResponse.json(
              { error: 'Too Many Requests' },
              { status: 429, headers: { 'RateLimit-Remaining': String(result.remaining) } }
            );
          }
        }
      } else if (pathname.startsWith('/api/members') || pathname.startsWith('/api/companies/provision')) {
        const memberLimit = rateLimiters.memberPerHour;
        if (memberLimit) {
          const result = await memberLimit.limit(`${userKey}:member`);
          if (!result.success) {
            return NextResponse.json(
              { error: 'Too Many Requests' },
              { status: 429, headers: { 'RateLimit-Remaining': String(result.remaining) } }
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('[middleware] Rate limiting error:', error);
    // エラー時はリクエスト通過（フェイルオープン）
    return NextResponse.next();
  }

  return NextResponse.next();
}

// middleware が動作する対象パスの定義
export const config = {
  matcher: [
    // AI生成系 API
    '/api/generate-:path*',
    '/api/stage:path*/generate-:path*',
    '/api/stage5/assist-execution',
    '/api/recommend-:path*',
    '/api/okr-from-exec',
    '/api/ask-ceo-agent',
    '/api/org-alignment/:path*/generate:path*',
    // 管理系 API
    '/api/invites/:path*',
    '/api/members/:path*',
    '/api/companies/provision',
  ],
};
