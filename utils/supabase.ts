import { StrategyState } from '@/store/strategyStore';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

// 🎯 戦略データ保存
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
      answers2: JSON.stringify(state.answers2 || []),
    };

    console.log('📤 Supabase保存リクエスト: ', payload);

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .upsert([payload], { onConflict: 'user_id' });

    if (error) throw error;

    console.log('✅ Supabase保存成功:', data);
    return { error: null };
  } catch (error) {
    console.error('❌ Supabase保存エラー詳細:', error instanceof Error ? error.message : error);
    return { error };
  }
}

// 🎯 戦略データ読み込み
export async function loadStrategyData(userId: string) {
  console.log('🔍 Supabase読み込み: user_id =', userId);

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw new Error(error.message || '読み込みに失敗しました');

    if (data.answers) data.answers = JSON.parse(data.answers);
    if (data.answers2) data.answers2 = JSON.parse(data.answers2);

    console.log('📥 Supabase読み込み成功:', data);
    return { data, error: null };
  } catch (error) {
    console.error('❌ Supabase読み込みエラー:', error instanceof Error ? error.message : error);
    return { data: null, error };
  }
}

// 🎯 戦略データ削除
export async function deleteStrategyData(userId: string) {
  try {
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    console.log('✅ Supabase削除成功');
    return { error: null };
  } catch (error) {
    console.error('❌ Supabase削除エラー:', error instanceof Error ? error.message : error);
    return { error };
  }
}

// ✅ 進捗ログを保存（/execution用）
export async function saveProgressLog(
  userId: string,
  okrId: string,
  progressText: string
) {
  try {
    const { error } = await supabase.from('progress_logs').insert([
      {
        user_id: userId,
        okr_id: okrId,
        progress_text: progressText,
      },
    ]);

    if (error) throw error;

    console.log(`✅ 進捗ログ保存成功: ${okrId}`);
    return null;
  } catch (error) {
    console.error('❌ 進捗ログ保存エラー:', error instanceof Error ? error.message : error);
    return error;
  }
}

// ✅ 第1ラウンド回答保存
export async function saveStoryAnswers(
  userId: string,
  answers: string[],
  questions: string[],
  reasons: string[]
) {
  try {
    const safeArray = (arr: string[]) => arr.map((v) => v ?? '');
    const payload = {
      user_id: userId,
      answers: JSON.stringify(safeArray(answers)),
      questions: JSON.stringify(safeArray(questions)),
      reasons: JSON.stringify(safeArray(reasons)),
    };

    console.log('📤 第1ラウンド保存リクエスト:', payload);

    const { error, data } = await supabase
      .from('story_answers')
      .upsert([payload], { onConflict: 'user_id' });

    if (error) {
      console.error('❌ Supabase upsert エラー:', JSON.stringify(error, null, 2));
      throw error;
    }

    console.log('✅ 第1ラウンド保存成功:', data);
    return null;
  } catch (error) {
    console.error(
      '❌ ストーリー回答保存エラー:',
      error instanceof Error ? error.message : JSON.stringify(error, null, 2)
    );
    return error;
  }
}

// ✅ 第1ラウンド回答読み込み
export async function loadStoryAnswers(userId: string): Promise<{
  answers: string[];
  questions: string[];
  reasons: string[];
} | null> {
  try {
    const { data, error } = await supabase
      .from('story_answers')
      .select('answers, questions, reasons')
      .eq('user_id', userId)
      .single();

    if (!data) {
      console.log('ℹ️ 第1ラウンド回答が存在しません（初回ユーザーの可能性あり）');
      return null;
    }

    return {
      answers: JSON.parse(data.answers || '[]'),
      questions: JSON.parse(data.questions || '[]'),
      reasons: JSON.parse(data.reasons || '[]'),
    };
  } catch (error) {
    console.error('❌ 第1ラウンド回答読み込みエラー:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ✅ 第2ラウンド回答保存
export async function saveStoryAnswers2(userId: string, answers2: string[]) {
  try {
    const payload = {
      user_id: userId,
      answers: JSON.stringify(answers2.map((v) => v ?? '')),
    };

    console.log('📤 第2ラウンド保存リクエスト:', payload);

    const { error, data } = await supabase
      .from('story_answers2')
      .upsert([payload], { onConflict: 'user_id' });

    if (error) {
      console.error('❌ Supabase upsert エラー:', JSON.stringify(error, null, 2));
      throw error;
    }

    console.log('✅ 第2ラウンド保存成功:', data);
    return null;
  } catch (error) {
    console.error(
      '❌ ストーリー回答2 保存エラー:',
      error instanceof Error ? error.message : JSON.stringify(error, null, 2)
    );
    return error;
  }
}

// ✅ 第2ラウンド回答読み込み
export async function loadStoryAnswers2(userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from('story_answers2')
      .select('answers')
      .eq('user_id', userId)
      .single();

    if (!data || !data.answers) {
      console.log('ℹ️ 第2ラウンド回答が存在しません（初回ユーザーの可能性あり）');
      return null;
    }

    return JSON.parse(data.answers);
  } catch (error) {
    console.error('❌ 第2ラウンド回答読み込みエラー:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ✅ ストーリー単独保存
export async function saveStoryToSupabase(
  userId: string,
  story: string,
  summary: string
) {
  try {
    const { error } = await supabase
      .from(TABLE_NAME)
      .upsert([{ user_id: userId, story, strategySummary: summary }], {
        onConflict: 'user_id',
      });

    if (error) throw error;

    console.log('✅ ストーリー単独保存成功');
  } catch (error) {
    console.error('❌ ストーリー単独保存エラー:', error instanceof Error ? error.message : error);
    throw new Error('ストーリーの保存に失敗しました');
  }
}

// ✅ 詳細ストーリー回答保存（ステップ別）
export async function saveDetailedStoryAnswers(
  userId: string,
  answers: {
    step: number;
    question: string;
    reason: string;
    answer: string;
  }[]
) {
  try {
    const { error } = await supabase
      .from('story_answers_detailed')
      .insert(
        answers.map((a) => ({
          user_id: userId,
          step_number: a.step,
          question: a.question,
          reason: a.reason,
          answer: a.answer,
        }))
      );

    if (error) throw error;

    console.log('✅ 詳細ストーリー回答保存成功');
  } catch (error) {
    console.error('❌ 詳細ストーリー回答保存エラー:', error instanceof Error ? error.message : error);
    throw new Error('詳細ストーリー回答の保存に失敗しました');
  }
}
