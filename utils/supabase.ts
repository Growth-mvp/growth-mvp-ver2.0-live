import { createClient } from '@supabase/supabase-js';
import { Department } from '@/types/strategy';
import { StrategyState } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore'; // ← ログイン中のユーザー取得

// Supabase初期化
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const supabase = createClient(supabaseUrl, supabaseKey);

// テーブル名
const TABLE_NAME = 'strategy_data';

// Supabaseに保存するデータ型
export type StrategyData = {
  user_id: string;
  companyName: string;
  foundationYear: string;
  location: string;
  industry: string;
  revenue: string;
  employees: string;
  businessContent: string;
  customerSegment: string;

  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;

  mission: string;
  vision: string;
  value: string;

  thought: string;

  story: string;
  strategySummary: string;
  csvFinanceData: any[];
  editableCascade: Department[];
};

// 保存関数（ログインユーザーごと）
export async function saveStrategyData(state: StrategyState) {
  const { user } = useUserStore.getState();
  if (!user?.id) return { data: null, error: new Error('ログインユーザーが不明です') };

  const data: StrategyData = {
    user_id: user.id,
    companyName: state.companyName,
    foundationYear: state.foundationYear,
    location: state.location,
    industry: state.industry,
    revenue: state.revenue,
    employees: state.employees,
    businessContent: state.businessContent,
    customerSegment: state.customerSegment,

    strength: state.strength,
    weakness: state.weakness,
    opportunity: state.opportunity,
    threat: state.threat,

    mission: state.mission,
    vision: state.vision,
    value: state.value,

    thought: state.thought,

    story: state.story,
    strategySummary: state.strategySummary,
    csvFinanceData: state.csvFinanceData,
    editableCascade: state.editableCascadeResult,
  };

  const { data: saved, error } = await supabase
    .from(TABLE_NAME)
    .upsert(data, { onConflict: 'user_id' }); // ユーザーごとに1件

  return { data: saved, error };
}

// 読込関数（ログインユーザーのみ）
export async function loadStrategyData() {
  const { user } = useUserStore.getState();
  if (!user?.id) return { data: null, error: new Error('ログインユーザーが不明です') };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', user.id)
    .single();

  return { data, error };
}

// 削除関数（ログインユーザーのデータだけ）
export async function deleteStrategyData() {
  const { user } = useUserStore.getState();
  if (!user?.id) return { error: new Error('ログインユーザーが不明です') };

  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('user_id', user.id);

  return { error };
}
