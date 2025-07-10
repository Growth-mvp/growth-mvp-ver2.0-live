import { createClient } from '@supabase/supabase-js';
import { StrategyState, Department } from '../store/strategyStore';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

// Supabaseに保存される構造と一致させた型
export type StrategyData = {
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
  story: string;
  strategySummary: string;
  csvFinanceData: any[];
  editableCascade: Department[]; // Supabaseのカラム名に合わせて整合
};

// 保存（アップサート）関数
export async function saveStrategyData(state: StrategyState) {
  const data: StrategyData = {
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
    story: state.story,
    strategySummary: state.strategySummary,
    csvFinanceData: state.csvFinanceData,
    editableCascade: state.editableCascadeResult,
  };

  const { data: saved, error } = await supabase
    .from(TABLE_NAME)
    .upsert(
      { ...data, user_id: 'demo_user' }, // 本番では user_id をログイン情報に差し替え
      { onConflict: 'user_id' }
    );

  return { data: saved, error };
}

// 読み込み関数（1レコードのみ想定）
export async function loadStrategyData() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', 'demo_user')
    .single();

  return { data, error };
}

// 削除関数（ユーザーIDに紐づく戦略データを削除）
export async function deleteStrategyData() {
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('user_id', 'demo_user');

  return { error };
}
