// /utils/supabase/index.ts
// 目的：Supabase 関連ユーティリティを1か所に集約するハブ。
// ★ 根本対策：レガシー経路の再エクスポートを停止し、
//   "誤って使えない" 状態にして再投入の根を断つ。

export * from './client';       // supabase クライアント・Cookie系（ガード付き）
export * from './errors';       // エラー処理・PostgRESTエラー整形
export * from './normalize';    // データ正規化・変換
export * from './membership';   // メンバー・ロール関連
export * from './strategy';     // 戦略データ（保存・取得・ログ）

// 🚫 レガシーや補助でレガシー表に書きうるモジュールは再エクスポートしない
// export * from './ancillary'; // ← （重要）外す。使っている呼び出し元があればエラーで気付ける。

// 互換：トップレベルから supabase を直接取得できるようにする
export { supabase } from './client';
