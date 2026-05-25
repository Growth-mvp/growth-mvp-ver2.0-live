// /utils/supabase/index.ts
'use client';

/**
 * 目的：
 *  - Supabase 関連ユーティリティを1か所に集約するハブ。
 *  - ただし `client.ts` は他の util に依存していない “leaf” なので、
 *    再エクスポートは strict に制御して循環依存を防ぐ。
 *
 * 原則：
 *  - client.ts → 他の util を import しない
 *  - index.ts → client を import しても、他から index に import させない
 *  - つまり、「上から下」方向の一方通行構造
 */

// ========================================================
// ⚙️ 安全なユーティリティ群（循環しないもののみ）
// ========================================================
export * from './errors';            // エラー整形・PostgRESTエラー抽出
export * from './normalize';         // データ正規化
export * from './membership';        // メンバー／ロール
export * from './strategy';          // 戦略データCRUD系
export * from './org-alignment';     // 組織変革・認識のズレCRUD系

// ========================================================
// ⚠️ client.ts は leaf 専用。直接再エクスポートするが、
// 他のモジュールから index 経由で参照しないこと。
// ========================================================
export { supabase, getBrowserSupabase, getSupabaseClient } from './client';

// ========================================================
// 🚫 レガシー経路の再エクスポートは禁止
// ========================================================
// export * from './ancillary';  // ← レガシーテーブル操作が含まれるためブロック
// export * from './legacy';     // ← 将来削除予定
