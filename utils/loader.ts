// /utils/loader.ts
import { useStrategyStore } from '@/store/strategyStore';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';

export async function loadAndHydrate(companyId: string) {
  if (!companyId) throw new Error('companyId is required');
  const { data, error } = await getFullStrategyDataByCompany(companyId);
  if (error) throw error;
  if (data) {
    // 返ってきた representation をそのままマージ
    useStrategyStore.setState((s) => ({ ...s, ...(data as Partial<typeof s>) }));
  } else {
    // 空会社なら初期化だけ反映（companyIdだけ保持）
    useStrategyStore.setState((s) => ({ ...s, companyId }));
  }
  return useStrategyStore.getState();
}
