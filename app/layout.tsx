// /app/layout.tsx
import './globals.css';
import { Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import LayoutClient from './layoutClient';
import AuthGuards from '@/components/AuthGuards';
import MembershipBootstrap from '@/components/MembershipBootstrap';
import AccessGate from '@/components/AccessGate'; // ★ 追加

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  userScalable: true,
};

export const metadata: Metadata = {
  title: 'GROWTH - 戦略実行プラットフォーム',
  description: '経営戦略を実行へつなげるSaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.className} min-h-dvh bg-white text-gray-900`}>
        <LayoutClient>
          <AuthGuards />
          <MembershipBootstrap />
          {/* 初期化が完了するまで children を描画しない（≒ early 404/誤判定を防止） */}
          <AccessGate>
            {children}
          </AccessGate>
        </LayoutClient>
      </body>
    </html>
  );
}
