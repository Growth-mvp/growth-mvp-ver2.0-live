import { supabase } from '@/utils/supabase/client';
import type { StoredRow, StrategyIo } from '@/lib/stage5/partialStrategyWrite';

const T_STRATEGY = 'strategy_data';

function toStoredRow(data: { id: unknown; revision: unknown; departments: unknown } | null): StoredRow | null {
  if (!data) return null;
  return {
    id: String(data.id),
    revision: Number(data.revision),
    departments: Array.isArray(data.departments) ? data.departments : [],
  };
}

export const strategyPartialIo: StrategyIo = {
  async read(companyId) {
    const { data, error } = await supabase
      .from(T_STRATEGY)
      .select('id, revision, departments')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) return { row: null, error };
    return { row: toStoredRow(data), error: null };
  },

  async write({ companyId, rowId, expectedRevision, departments, actorId }) {
    const { data, error } = await supabase
      .from(T_STRATEGY)
      .update({
        departments,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      })
      .eq('company_id', companyId)
      .eq('id', rowId)
      .eq('revision', expectedRevision)
      .select('id, revision, departments')
      .maybeSingle();
    if (error) return { row: null, error };
    return { row: toStoredRow(data), error: null };
  },
};
