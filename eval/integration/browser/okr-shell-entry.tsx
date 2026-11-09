/* 実際の /okr 画面を、実レイアウト（左ナビ・右のAI経営コンサルタント）の中で描画する（評価専用）。
 * 認証・通信・保存はstubs/で差し替え、DB・外部APIには接続しない。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import LayoutClient from '@/app/layoutClient';
import OKRPage from '@/app/okr/page';

createRoot(document.getElementById('root')!).render(
  <LayoutClient>
    <OKRPage />
  </LayoutClient>,
);
