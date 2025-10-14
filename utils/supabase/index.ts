// /utils/supabase/index.ts
// 目的：Supabase 関連ユーティリティを1か所に集約するハブ。
// 各モジュールをこの index から再エクスポートすることで、呼び出し元は import 経路を統一できる。
// 例）import { saveStrategyData } from '@/utils/supabase';

export * from './client';       // supabase クライアント・Cookie系
export * from './errors';       // エラー処理・PostgRESTエラー整形
export * from './normalize';    // データ正規化・変換
export * from './membership';   // メンバー・ロール関連
export * from './strategy';     // 戦略データ（保存・取得・ログ）
export * from './ancillary';    // 補助系ユーティリティ（通知・付帯処理など）

// 追加：トップレベルからも supabase を直接取得できるようにする
export { supabase } from './client';
