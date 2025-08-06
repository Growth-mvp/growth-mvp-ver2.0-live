import './globals.css';
import { Inter } from 'next/font/google';
import LayoutClient from './layoutClient';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata = {
  title: 'GROWTH - 戦略実行プラットフォーム',
  description: '経営戦略を実行へつなげるSaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.className} bg-gradient-to-b from-gray-100 to-white text-gray-900`}>
        <div className="pl-4"> {/* ← Sidebar (w-72 = 18rem) に合わせて余白を確保 */}
          <LayoutClient>{children}</LayoutClient>
        </div>
      </body>
    </html>
  );
}
