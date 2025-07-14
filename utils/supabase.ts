import { createClient } from '@supabase/supabase-js';
import { Department } from '@/types/strategy'; // ✅ 統一型の読み込み
import { StrategyState } from '@/store/strategyStore'; // 状態全体の型

// Supabase初期化
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// テーブル名
const TABLE_NAME = 'strategy_data';

// Supabaseに保存するデータ型（StrategyStateから抽出）
export type StrategyData = {
  user_id: string; // 識別子（仮に 'demo_user' を使用）
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

  thought: string; // 経営者の思い

  story: string;
  strategySummary: string;
  csvFinanceData: any[];
  editableCascade: Department[];
};

// 保存関数
export async function saveStrategyData(state: StrategyState) {
  const data: StrategyData = {
    user_id: 'demo_user', // 今後ユーザー対応可能
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
    .upsert(data, { onConflict: 'user_id' }); // ← user_idが一意キー

  return { data: saved, error };
}

// 読込関数
export async function loadStrategyData() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', 'demo_user')
    .single();

  return { data, error };
}

// 削除関数
export async function deleteStrategyData() {
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('user_id', 'demo_user');

  return { error };
}
