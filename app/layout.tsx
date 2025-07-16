import './globals.css';
import { Inter } from 'next/font/google';
import { metadata } from './metadata'; // ← 任意で切り出してもOK
import LayoutClient from './layoutClient'; // ✅ Clientコンポーネントに分離

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata = {
  title: 'GROWTH - 戦略実行プラットフォーム',
  description: '経営戦略を実行へつなげるSaaS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.className} bg-gradient-to-b from-gray-100 to-white text-gray-900`}>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  );
}
