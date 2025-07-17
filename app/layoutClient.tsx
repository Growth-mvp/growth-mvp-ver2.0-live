// app/layoutClient.tsx
'use client';

import Sidebar from '@/components/Sidebar';
import CEOChatPanel from '@/components/CEOChatPanel';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex flex-1 overflow-hidden bg-white shadow-inner rounded-l-2xl">
        <div className="flex-1 p-6 overflow-y-auto">
          {children}
        </div>
        <div className="w-[360px] border-l bg-gray-50 shadow-inner hidden xl:block">
          <CEOChatPanel />
        </div>
      </main>
    </div>
  );
}
