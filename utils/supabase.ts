import { StrategyState } from '@/store/strategyStore';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

// 🎯 戦略データ保存
export async function saveStrategyData(state: StrategyState, userId: string) {
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

// 🎯 戦略データ読み込み
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

// 🎯 戦略データ削除
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

// ✅ 進捗ログを保存（/execution用）
export async function saveProgressLog(
  userId: string,
  okrId: string,
  progressText: string
) {
  const { error } = await supabase.from('progress_logs').insert([
    {
      user_id: userId,
      okr_id: okrId,
      progress_text: progressText,
    },
  ]);

  if (error) {
    console.error('❌ 進捗ログ保存エラー:', error);
  } else {
    console.log(`✅ 進捗ログ保存成功: ${okrId}`);
  }

  return error;
}
