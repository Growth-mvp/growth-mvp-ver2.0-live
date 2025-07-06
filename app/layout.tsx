// app/layout.tsx
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import CEOChatPanel from "@/components/CEOChatPanel";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="flex">
        <Sidebar />
        <main className="ml-64 w-full min-h-screen flex">
          <div className="flex-1 bg-white overflow-y-auto">
            {children}
          </div>
          <div className="w-[400px] border-l bg-gray-50">
            <CEOChatPanel />
          </div>
        </main>
      </body>
    </html>
  );
}
