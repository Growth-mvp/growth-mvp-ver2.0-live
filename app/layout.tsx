// /app/layout.tsx
import './globals.css';
import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import LayoutClient from './layoutClient';
import AuthGuards from '@/components/AuthGuards'; // 無効トークン自動復旧
import MembershipBootstrap from '@/components/MembershipBootstrap'; // 会社所属＆role同期

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'GROWTH - 戦略実行プラットフォーム',
  description: '経営戦略を実行へつなげるSaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      {/* dvh を使った全画面レイアウトの安定化 */}
      <body className={`${inter.className} min-h-dvh bg-gradient-to-b from-gray-100 to-white text-gray-900`}>
        {/* Provider（ストア / Supabase クライアント / Toaster 等）を内包している想定 */}
        <LayoutClient>
          {/* 起動時/フォーカス復帰時にセッション健全性を自動チェック */}
          <AuthGuards />
          {/* company_members → store（companyId / role）へ同期（membership=0件も正常として処理） */}
          <MembershipBootstrap />
          {/* 以降のUIは store の role / companyId に基づいて権限判定 */}
          {children}
        </LayoutClient>
      </body>
    </html>
  );
}
