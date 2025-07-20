import { StrategyState } from '@/store/strategyStore';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

export async function saveStrategyData(state: StrategyState, userId: string) {
  // 📝 Supabaseに送るデータ構築
  const payload = {
    user_id: userId,
    companyName: state.companyName,
    foundationYear: state.foundationYear,
    location: state.location,
    industry: state.industry,
    revenue: state.revenue,
    employees: state.employees,
    businessContent: state.businessContent,
    customerSegment: state.customerSegment,
    thought: state.thought,
    strength: state.strength,
    weakness: state.weakness,
    opportunity: state.opportunity,
    threat: state.threat,
    mission: state.mission,
    vision: state.vision,
    value: state.value,
    story: state.story,
    strategySummary: state.strategySummary,
    editableCascade: state.editableCascadeResult,
    csvFinanceData: state.csvFinanceData,
  };

  // ✅ 送信内容を表示（デバッグ用）
  console.log('📤 Supabase保存リクエスト: ', payload);

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert([payload], { onConflict: 'user_id' });

  if (error) {
    console.error('❌ Supabase保存エラー詳細:', error);
  } else {
    console.log('✅ Supabase保存成功:', data);
  }

  return { error };
}

export async function loadStrategyData(userId: string) {
  console.log('🔍 Supabase読み込み: user_id =', userId);
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('❌ Supabase読み込みエラー:', error);
  } else {
    console.log('📥 Supabase読み込み成功:', data);
  }

  return { data, error };
}

export async function deleteStrategyData(userId: string) {
  console.log('🗑 Supabase削除リクエスト: user_id =', userId);
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('❌ Supabase削除エラー:', error);
  } else {
    console.log('✅ Supabase削除成功');
  }

  return { error };
}
