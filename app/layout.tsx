// app/layout.tsx
import './globals.css';
import Sidebar from '@/components/Sidebar';
import CEOChatPanel from '@/components/CEOChatPanel';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata = {
  title: 'GROWTH - 戦略実行プラットフォーム',
  description: '経営戦略を実行へつなげるSaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.className} bg-gradient-to-b from-gray-100 to-white text-gray-900`}>
        <div className="flex min-h-screen">
          {/* 左サイドバー */}
          <Sidebar />

          {/* メイン + CEOチャット */}
          <main className="flex flex-1 overflow-hidden bg-white shadow-inner rounded-l-2xl">
            {/* メインコンテンツ */}
            <div className="flex-1 p-6 overflow-y-auto">
              {children}
            </div>

            {/* CEOチャットパネル（右固定） */}
            <div className="w-[360px] border-l bg-gray-50 shadow-inner hidden xl:block">
              <CEOChatPanel />
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
