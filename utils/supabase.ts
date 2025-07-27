import { StrategyState } from '@/store/strategyStore';
import { ChapterAnswers } from '@/types/strategy';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

// 🎯 戦略データ保存（全体）
export async function saveStrategyData(state: StrategyState, userId: string) {
  try {
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
      answers: JSON.stringify(state.answers || []),
      answers2: state.answers2 || [],
    };

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .upsert([payload], { onConflict: 'user_id' });

    if (error) throw error;

    console.log('✅ Supabase保存成功:', data);
    return { error: null };
  } catch (error) {
    console.error('❌ Supabase保存エラー:', error);
    return { error };
  }
}

// 🎯 戦略データ読み込み
export async function loadStrategyData(userId: string) {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    if (data.answers) data.answers = JSON.parse(data.answers);
    return { data, error: null };
  } catch (error) {
    console.error('❌ Supabase読み込みエラー:', error);
    return { data: null, error };
  }
}

// 🎯 戦略データ削除（全体）
export async function deleteStrategyData(userId: string) {
  try {
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    console.log('🗑️ Supabase削除成功');
    return { error: null };
  } catch (error) {
    console.error('❌ Supabase削除エラー:', error);
    return { error };
  }
}

// ✅ 第2ラウンド回答保存（章構造）
export async function saveStoryAnswers2(userId: string, answers2: ChapterAnswers[]) {
  try {
    const payload = {
      user_id: userId,
      answers2,
    };

    const { error } = await supabase
      .from('story_answers2')
      .upsert([payload], { onConflict: 'user_id' });

    if (error) throw error;
    console.log('✅ 第2ラウンド保存成功');
    return null;
  } catch (error) {
    console.error('❌ 第2ラウンド保存エラー:', error);
    return error;
  }
}

// ✅ 第2ラウンド回答読み込み
export async function loadStoryAnswers2(userId: string): Promise<ChapterAnswers[] | null> {
  try {
    const { data } = await supabase
      .from('story_answers2')
      .select('answers2')
      .eq('user_id', userId)
      .single();

    return data?.answers2 || null;
  } catch (error) {
    console.error('❌ 第2ラウンド読み込みエラー:', error);
    return null;
  }
}
