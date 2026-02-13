'use client';

import { useMemo, useState } from 'react';
import type { ApprovedProject } from '@/utils/stage6';
import type { YearlyPL } from '@/utils/financeSimulation';
import { diffYearly, sumYearly } from '@/utils/stage6';

/**
 * useProjectFilters
 * Manages project filtering, selection, and summary calculations for Tab1
 *
 * Extracted from app/stage6/page.tsx to reduce component complexity
 */
export function useProjectFilters({
  core,
  selectedYearly,
}: {
  core: any; // Stage6Core
  selectedYearly?: { base?: YearlyPL[] };
}) {
  // ===== State =====
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [selectedProjectKeys, setSelectedProjectKeys] = useState<string[]>([]);

  // ===== Computed Values =====

  /** All project keys from core.projectKrsMap */
  const allProjectKeys = useMemo(() => Array.from(core.projectKrsMap.keys()), [core.projectKrsMap]);

  /** Effective selected keys: if empty, default to all projects */
  const effectiveSelectedKeys = useMemo(
    () => (selectedProjectKeys.length > 0 ? selectedProjectKeys : allProjectKeys),
    [selectedProjectKeys, allProjectKeys],
  );

  /** Approved projects filtered by department */
  const approvedFiltered = useMemo(() => {
    if (!core.ready) return [] as ApprovedProject[];

    if (deptFilter === 'all') return core.approved;
    return core.approved.filter((p: any) => p.dept === deptFilter);
  }, [core.ready, core.approved, deptFilter]);

  /** Set of currently selected project keys (for O(1) lookup) */
  const selectedSet = useMemo(() => new Set(selectedProjectKeys), [selectedProjectKeys]);

  /** Summary of selected projects: revenue delta, op income delta, total investment */
  const selectedSummary = useMemo(() => {
    const baseline = core.baselineYearly ?? [];
    const sel = selectedYearly?.base ?? [];
    const delta = diffYearly(baseline, sel);
    const deltaRev = sumYearly(delta, 'revenue');
    const deltaOp = sumYearly(delta, 'op_income');

    const invest = core.approved
      .filter((p: any) => selectedSet.has(p.key))
      .reduce((s: number, p: any) => s + (p.investTotal ?? 0), 0);

    return { deltaRev, deltaOp, invest };
  }, [core.baselineYearly, selectedYearly, core.approved, selectedSet]);

  // ===== Handlers =====

  /** Toggle project selection (add/remove from selected) */
  const toggleProject = (key: string) => {
    setSelectedProjectKeys((prev) => {
      const set = new Set(prev);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return Array.from(set);
    });
  };

  /** Select all projects in current department filter */
  const selectAllFiltered = () => {
    setSelectedProjectKeys((prev) => {
      const set = new Set(prev);
      approvedFiltered.forEach((p: ApprovedProject) => set.add(p.key));
      return Array.from(set);
    });
  };

  /** Clear all projects in current department filter */
  const clearAllFiltered = () => {
    setSelectedProjectKeys((prev) => {
      const set = new Set(prev);
      approvedFiltered.forEach((p: ApprovedProject) => set.delete(p.key));
      return Array.from(set);
    });
  };

  return {
    // State
    deptFilter,
    setDeptFilter,
    selectedProjectKeys,
    setSelectedProjectKeys,
    // Computed
    allProjectKeys,
    effectiveSelectedKeys,
    approvedFiltered,
    selectedSet,
    selectedSummary,
    // Handlers
    toggleProject,
    selectAllFiltered,
    clearAllFiltered,
  };
}
