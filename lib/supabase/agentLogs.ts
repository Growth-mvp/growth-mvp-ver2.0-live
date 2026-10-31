// lib/supabase/agentLogs.ts
// サーバー専用。呼び出し元は会社スコープ検証済みの strategyId のみを渡すこと。
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function insertAgentLog({
  userId,
  strategyId,
  step,
  role,
  content,
}: {
  userId: string;
  strategyId: string;
  step: number;
  role: 'user' | 'assistant';
  content: string;
}) {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('agent_logs').insert([
    {
      user_id: userId,
      strategy_id: strategyId,
      step,
      role,
      content,
    },
  ]);

  if (error) {
    console.error('❌ agent_logs 保存エラー:', error.message);
    throw new Error('ログ保存に失敗しました');
  }
}
