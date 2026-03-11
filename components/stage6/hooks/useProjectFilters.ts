'use client';

import { useMemo, useState } from 'react';
import type { ApprovedProject } from '@/utils/stage6';

/**
 * useProjectFilters
 * Manages project filtering, selection, and summary calculations for Tab1
 *
 * Extracted from app/stage6/page.tsx to reduce component complexity
 */
export function useProjectFilters({
  core,
  projectContrib,
}: {
  core: any; // Stage6Core
  projectContrib?: any[]; // ProjectContribution[]
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

  /** Set of effective selected keys (if empty, default to all projects) */
  const effectiveSet = useMemo(() => new Set(effectiveSelectedKeys), [effectiveSelectedKeys]);

  /** Summary of selected projects: revenue delta, op income delta, total investment
   * ★ FIX: Use projectContrib single-year values instead of sumYearly cumulative
   * ★ FIX: Use effectiveSelectedKeys (not selectedSet) so unselected shows all projects
   * This ensures selectedSummary uses same source and period as TabImpact rows
   */
  const selectedSummary = useMemo(() => {
    // Sum deltaRevenueTotal and deltaOpTotal from selected projects in projectContrib
    const projContrib = projectContrib ?? [];
    const deltaRev = projContrib
      .filter((p: any) => effectiveSet.has(p.key))
      .reduce((s: number, p: any) => s + (p.deltaRevenueTotal ?? 0), 0);

    const deltaOp = projContrib
      .filter((p: any) => effectiveSet.has(p.key))
      .reduce((s: number, p: any) => s + (p.deltaOpTotal ?? 0), 0);

    const invest = core.approved
      .filter((p: any) => effectiveSet.has(p.key))
      .reduce((s: number, p: any) => s + (p.investTotal ?? 0), 0);

    return { deltaRev, deltaOp, invest };
  }, [projectContrib, core.approved, effectiveSet]);

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
