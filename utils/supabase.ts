import { createClient } from '@supabase/supabase-js';
import { StrategyState } from '../store/strategyStore';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'strategy_data';

export type StrategyData = Pick<
  StrategyState,
  | 'companyName'
  | 'foundationYear'
  | 'location'
  | 'industry'
  | 'revenue'
  | 'employees'
  | 'businessContent'
  | 'customerSegment'
  | 'strength'
  | 'weakness'
  | 'opportunity'
  | 'threat'
  | 'mission'
  | 'vision'
  | 'value'
  | 'csvFinanceData'
  | 'story'
  | 'editableCascadeResult' // ✅ 追加！
>;

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
    csvFinanceData: state.csvFinanceData,
    story: state.story,
    editableCascadeResult: state.editableCascadeResult, // ✅ 追加！
  };

  const { error } = await supabase
    .from(TABLE_NAME)
    .upsert({ ...data, user_id: 'demo_user' });

  return { error };
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
