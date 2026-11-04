/* 流れの検証用：STAGE5 実行画面の実コンポーネント（app/execution/page.tsx）を描画する（評価専用）。
 * 保存先は localStorage（stubs/flowStore.ts）。DB・認証・通信には接続しない。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import ExecutionPage from '@/app/execution/page';

createRoot(document.getElementById('root')!).render(<ExecutionPage />);
