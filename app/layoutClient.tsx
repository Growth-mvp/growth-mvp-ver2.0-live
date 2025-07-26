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
    <div className="min-h-screen relative">
      {!hideSidebar && <Sidebar />}

      <main
        className={`min-h-screen transition-all ${
          !hideSidebar ? 'pl-72 pr-96' : ''
        } bg-gray-200 p-6`} // ← 単色の薄いグレーに変更
      >
        {children}
      </main>

      {!hideSidebar && (
        <aside className="fixed top-0 right-0 w-96 h-screen bg-white border-l border-gray-200 shadow-inner z-10">
          <CEOChatPanel />
        </aside>
      )}
    </div>
  );
}
