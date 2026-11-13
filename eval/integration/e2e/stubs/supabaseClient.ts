/* 評価用：認証の代わり。セッションは持たず、APIの認証は画面のトークン（test:<利用者ID>）で行う */
export const safeGetSession = async () => ({ data: { session: null }, error: null });
export const supabase = {};
export const createClient = () => supabase;
