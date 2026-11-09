/* 実アプリのレイアウト（左サイドバー・右AIペイン・STAGE6ページ）を、モック認証のもとで描画する（評価専用）。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import LayoutClient from '@/app/layoutClient';
import Stage6Page from '@/app/stage6/page';

createRoot(document.getElementById('root')!).render(
  <LayoutClient>
    <Stage6Page />
  </LayoutClient>,
);
