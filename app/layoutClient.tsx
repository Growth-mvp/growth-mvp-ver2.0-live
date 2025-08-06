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
    <div className="min-h-screen relative flex">
      {/* 左サイドバー */}
      {!hideSidebar && <Sidebar />}

      {/* 中央ペイン（←修正ポイント） */}
      <main
        className={`flex-1 bg-gradient-to-b from-gray-100 to-white p-8 ${
          !hideSidebar ? 'ml-[18rem] mr-[24rem]' : ''
        }`}
      >
        {children}
      </main>

      {/* 右のエージェントペイン */}
      {!hideSidebar && (
        <aside className="fixed top-0 right-0 w-96 h-screen bg-white border-l border-gray-200 shadow-inner z-10">
          <div className="h-12 bg-gradient-to-r from-blue-800 to-blue-600 text-white text-center flex items-center justify-center font-semibold">
            経営者AIエージェント
          </div>
          <CEOChatPanel />
        </aside>
      )}
    </div>
  );
}
