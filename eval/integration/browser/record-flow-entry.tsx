/* 記録の追加・編集・削除・再読込の流れを検証する（評価専用）。実際の app/execution/page.tsx を描画し、
 * 保存先は stubs/recordStore.ts（localStorage の表）。計画・OKR・PDF などの周辺は plan-flow と同じスタブを使う。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import ExecutionPage from '@/app/execution/page';

createRoot(document.getElementById('root')!).render(<ExecutionPage />);
