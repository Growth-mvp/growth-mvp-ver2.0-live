/* 流れの検証用：STAGE5 実行画面（実際の app/execution/page.tsx）で、STAGE4で開始した計画の表示・記録・PDFを描画する（評価専用）。
 * 保存先は localStorage（stubs/flowStore.ts）。計画の読み込み・OKRの作成・活動ログ・PDF は stubs/ で遮断する。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import ExecutionPage from '@/app/execution/page';

createRoot(document.getElementById('root')!).render(<ExecutionPage />);
