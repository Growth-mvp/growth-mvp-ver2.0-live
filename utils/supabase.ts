import { StrategyData, ChapterAnswers, ChapterStory } from '@/types/strategy';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

// 戦略データ保存（全体）
export async function saveStrategyData(state: StrategyData, userId: string) {
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
      role: state.role,
      story: state.story,
      finalStory: state.finalStory || [],
      strategySummary: state.strategySummary,
      editableCascadeResult: state.editableCascadeResult,
      csvFinanceData: state.csvFinanceData,
      answers: state.answers || [],
      answers2: state.answers2 || [],
      questions: state.questions || [],
      reasons: state.reasons || [],
      questions2: state.questions2 || [],
      reasons2: state.reasons2 || [],
    };

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .upsert([payload], { onConflict: 'user_id' });

    if (error) throw error;
    return { error: null };
  } catch (error: any) {
    console.error('❌ Supabase保存エラー:', error?.message || error);
    return { error };
  }
}

// 戦略データ読み込み
export async function loadStrategyData(userId: string) {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    if (data && typeof data.answers2 === 'string') {
      try {
        data.answers2 = JSON.parse(data.answers2);
      } catch (e) {
        console.warn('⚠️ answers2のJSON.parseに失敗しました:', e);
        data.answers2 = [];
      }
    }

    if (!Array.isArray(data.answers2)) {
      data.answers2 = [];
    }

    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
}

// 戦略データ削除（全体）
export async function deleteStrategyData(userId: string) {
  try {
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
    return { error: null };
  } catch (error: any) {
    return { error };
  }
}

// 第2ラウンド回答保存
export async function saveStoryAnswers2(userId: string, answers2: ChapterAnswers[]) {
  try {
    const payload = { user_id: userId, answers2 };
    const { error } = await supabase
      .from('story_answers2')
      .upsert([payload], { onConflict: 'user_id' });

    if (error) throw error;
    return null;
  } catch (error: any) {
    return error;
  }
}

// 第2ラウンド回答読み込み
export async function loadStoryAnswers2(userId: string): Promise<ChapterAnswers[] | null> {
  try {
    const { data } = await supabase
      .from('story_answers2')
      .select('answers2')
      .eq('user_id', userId)
      .single();

    let result = data?.answers2;

    if (typeof result === 'string') {
      try {
        result = JSON.parse(result);
      } catch (e) {
        result = [];
      }
    }

    if (!Array.isArray(result)) {
      result = [];
    }

    return result;
  } catch (error: any) {
    return null;
  }
}

// ✅ OKR進捗ログ保存（統一・修正版）
export async function saveProgressLog(
  userId: string,
  okrId: string,
  log: {
    progressText?: string;
    rating?: number;
    ratingComment?: string;
    advice?: string;
    helpRequest?: string;
    department?: string;
  }
) {
  try {
    const { error } = await supabase.from('progress_logs').insert([
      {
        user_id: userId,
        okr_id: okrId,
        progress_text: log.progressText ?? '',
        rating: log.rating ?? null,
        rating_comment: log.ratingComment ?? '',
        advice: log.advice ?? '',
        help_request: log.helpRequest ?? '',
        department: log.department ?? '',
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;
    return null;
  } catch (error: any) {
    console.error('❌ 進捗ログ保存エラー:', error?.message || error);
    return error;
  }
}

// 最終ストーリー保存
export async function saveFinalStory(userId: string, story: ChapterStory[], summary: string) {
  try {
    const { error } = await supabase.from('final_stories').upsert(
      [
        {
          user_id: userId,
          story,
          summary,
        },
      ],
      { onConflict: 'user_id' }
    );

    if (error) throw error;
    return null;
  } catch (error: any) {
    return error;
  }
}

// 最終ストーリー読み込み
export async function loadFinalStory(userId: string): Promise<ChapterStory[] | null> {
  try {
    const { data, error } = await supabase
      .from('final_stories')
      .select('story')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data?.story || null;
  } catch (error: any) {
    return null;
  }
}
