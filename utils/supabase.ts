import { createClient } from '@supabase/supabase-js';
import { StrategyState, Department } from '../store/strategyStore';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

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

  thought: string; // ✅ 追加：経営者の思い

  story: string;
  strategySummary: string;
  csvFinanceData: any[];
  editableCascade: Department[]; // Supabase カラム名と一致
};

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

    thought: state.thought, // ✅ 追加

    story: state.story,
    strategySummary: state.strategySummary,
    csvFinanceData: state.csvFinanceData,
    editableCascade: state.editableCascadeResult,
  };

  const { data: saved, error } = await supabase
    .from(TABLE_NAME)
    .upsert(
      { ...data, user_id: 'demo_user' },
      { onConflict: 'user_id' }
    );

  return { data: saved, error };
}

export async function loadStrategyData() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', 'demo_user')
    .single();

  return { data, error };
}

export async function deleteStrategyData() {
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('user_id', 'demo_user');

  return { error };
}
