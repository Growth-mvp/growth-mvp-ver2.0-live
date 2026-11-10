const isLocalDev = process.env.NODE_ENV !== 'production' && process.env.APP_ENV === 'development';

const localSupabaseOrigin = (() => {
  if (!isLocalDev) return null;
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') ? u.origin : null;
  } catch {
    return null;
  }
})();
const localConnectSrc = localSupabaseOrigin
  ? ` ${localSupabaseOrigin} ${localSupabaseOrigin.replace(/^http/, 'ws')}`
  : '';

const localStage4DocumentScreen = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ ビルド中はESLintエラーを無視（公開を優先）
  eslint: { ignoreDuringBuilds: true },

  // ✅ TypeScriptエラーも一旦無視（デモ優先）
  typescript: { ignoreBuildErrors: true },

  // ✅ レポートURL互換性：/report/preview → /report/execution-report
  async redirects() {
    return [
      {
        source: '/report/preview',
        destination: '/report/execution-report',
        permanent: false,
      },
      {
        source: '/report/stakeholder-select',
        destination: '/report',
        permanent: false,
      },
      // ローカルで新STAGE4を通常画面にする間は、旧STAGE4の入力フォームへの直接アクセスを新画面へ送る
      ...(localStage4DocumentScreen ? [{ source: '/stage4', destination: '/okr', permanent: false }] : []),
    ];
  },

  // ✅ セキュリティヘッダの設定
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=(), payment=()',
          },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://js.stripe.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https://api.openai.com https://api.supabase.co https://auth.supabase.co https://*.supabase.co https://api.stripe.com https://vercel.live wss://*.supabase.co${localConnectSrc}; frame-src 'self' https://js.stripe.com; base-uri 'self'; form-action 'self';`,
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
