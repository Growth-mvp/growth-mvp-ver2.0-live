/* STAGE4 OKR画面の実コンポーネント（app/okr/page.tsx）をハーネスで描画する（評価専用）。
 * store・認証・通信は stubs/ で差し替え、DB・外部APIには接続しない。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import OKRPage from '@/app/okr/page';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

/* 保存後の再読込で使う正規化関数（実コード）。保存そのものは行わない。 */
(window as any).__normalizeStrategyData = normalizeStrategyData;

createRoot(document.getElementById('root')!).render(<OKRPage />);
