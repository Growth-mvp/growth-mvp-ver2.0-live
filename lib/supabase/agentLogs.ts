// lib/supabase/agentLogs.ts

// ✅ ここを修正：createClient ではなく supabase を直接インポート
import { supabase } from '@/utils/supabase/client';

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
  const { error } = await supabase.from('agent_logs').insert([
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
