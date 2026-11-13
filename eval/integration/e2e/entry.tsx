/* 評価用の画面の入口：実際の STAGE4（文書型）を描画する。店舗・認証・ルーターだけがスタブ。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import Stage4DocumentScreen from '@/components/okr/execution-plan/Stage4DocumentScreen';
import { IDS } from './ids';

const w = window as unknown as Record<string, unknown>;
w.__stage4ApiBase = '';
w.__stage4Token = `test:${IDS.alice}`;

createRoot(document.getElementById('root')!).render(<Stage4DocumentScreen />);
