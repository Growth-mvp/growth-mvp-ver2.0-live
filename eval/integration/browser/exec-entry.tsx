/* STAGE5 実行画面（app/execution/page.tsx）をハーネスで描画する（評価専用）。通信・保存は stubs/ で遮断する。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import ExecutionPage from '@/app/execution/page';

createRoot(document.getElementById('root')!).render(<ExecutionPage />);
