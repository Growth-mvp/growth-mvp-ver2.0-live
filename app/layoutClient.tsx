'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import CEOChatPanel from '@/components/CEOChatPanel';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const hideSidebar =
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/404');

  return (
    <div className="min-h-screen flex">
      {/* 左サイドバー */}
      {!hideSidebar && <Sidebar />}

      {/* 中央ペイン */}
      <main
        className={`flex-1 transition-all ${
          !hideSidebar ? 'pl-6' : ''
        } bg-gradient-to-b from-gray-100 to-white py-4 px-6`}
      >
        {children}
      </main>

      {/* 右ペイン：経営者AIエージェント */}
      {!hideSidebar && (
        <aside className="fixed top-0 right-0 w-96 h-screen bg-white border-l border-gray-200 shadow-inner z-10 flex flex-col">
          {/* ヘッダー（ネイビーグラデーション＋中央寄せテキスト） */}
          <header className="p-4 bg-gradient-to-r from-blue-900 to-blue-700 text-white text-center text-lg font-semibold flex items-center justify-center h-16">
            経営者AIエージェント
          </header>

          {/* チャットパネル本体 */}
          <div className="flex-1 overflow-y-auto">
            <CEOChatPanel />
          </div>
        </aside>
      )}
    </div>
  );
}
