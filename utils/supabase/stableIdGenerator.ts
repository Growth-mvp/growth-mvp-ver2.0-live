// /utils/supabase/stableIdGenerator.ts
/**
 * Stable ID Generation for Department and Project
 *
 * 役割：
 * - department/project に deterministic stable id を生成
 * - restore 後も同じ id を維持（再現可能性重視）
 * - title ベース紐づけを禁止（departmentId 優先）
 * - gen_random_uuid() fallback を禁止
 *
 * 生成ルール：
 * - Department: strategyId + "::dept::" + name
 * - Project: strategyId + "::proj::" + departmentId + "::" + laneType + "::" + title
 *
 * Hash:
 * - Deterministic（seed が同じ → 常に同じ id）
 * - hex12 以上で衝突確率を低下
 */

/**
 * Deterministic hash from seed
 * Returns hex string (32+ chars depending on hash length)
 */
function hashFromSeed(seed: string, hexLength: number = 12): string {
  if (!seed) {
    throw new Error('[stableIdGenerator] seed cannot be empty');
  }

  // Simple but deterministic hash function
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert to hex and pad to desired length
  const hexStr = Math.abs(hash).toString(16);
  return hexStr.padStart(hexLength, '0').slice(0, hexLength);
}

/**
 * Generate Department ID
 *
 * Seed: strategyId + "::dept::" + name
 * Format: "dept-{hex12}"
 *
 * @param strategyId - Strategy UUID
 * @param name - Department name (e.g., "営業部", "Engineering")
 * @returns stable department id (e.g., "dept-a1b2c3d4e5f6")
 */
export function generateDepartmentId(strategyId: string, name: string): string {
  if (!strategyId || !name) {
    throw new Error('[stableIdGenerator.generateDepartmentId] strategyId and name required');
  }

  const seed = `${strategyId}::dept::${name}`;
  const hash = hashFromSeed(seed, 12);
  return `dept-${hash}`;
}

/**
 * Generate Project ID
 *
 * Seed: strategyId + "::proj::" + departmentId + "::" + laneType + "::" + title
 * Format: "proj-{hex12}"
 *
 * ★ departmentId 優先（deptName 変更で id が変わらないようにするため）
 *
 * @param strategyId - Strategy UUID
 * @param departmentId - Department stable id (NOT name)
 * @param title - Project title
 * @param laneType - Lane type ("existing" | "new") -衝突回避用
 * @returns stable project id (e.g., "proj-b2c3d4e5f6a7")
 */
export function generateProjectId(
  strategyId: string,
  departmentId: string,
  title: string,
  laneType: 'existing' | 'new' = 'existing',
): string {
  if (!strategyId || !departmentId || !title) {
    throw new Error('[stableIdGenerator.generateProjectId] strategyId, departmentId, and title required');
  }

  // departmentId 優先：部門名変更で project.id が変わるのを防ぐ
  const seed = `${strategyId}::proj::${departmentId}::${laneType}::${title}`;
  const hash = hashFromSeed(seed, 12);
  return `proj-${hash}`;
}

/**
 * Generate generic stable ID from namespace and seed
 *
 * For other use cases beyond department/project
 *
 * @param namespace - Namespace (e.g., "okr", "kpi")
 * @param seed - Seed string
 * @param prefix - ID prefix (default: namespace)
 * @returns stable id (e.g., "okr-a1b2c3d4e5f6")
 */
export function generateStableIdFromSeed(
  namespace: string,
  seed: string,
  prefix?: string,
): string {
  if (!namespace || !seed) {
    throw new Error('[stableIdGenerator.generateStableIdFromSeed] namespace and seed required');
  }

  const hash = hashFromSeed(seed, 12);
  const prefixStr = prefix || namespace;
  return `${prefixStr}-${hash}`;
}

/**
 * Ensure Department has stable ID
 *
 * If dept.id is missing or invalid, generate it
 * Otherwise return as-is
 */
export function ensureDepartmentId(
  strategyId: string,
  dept: { id?: string | number; name: string; [key: string]: any },
): { id: string; [key: string]: any } {
  // If id exists and is non-empty, keep it
  if (dept.id && String(dept.id).trim()) {
    return {
      ...dept,
      id: String(dept.id),
    };
  }

  // Generate id from name
  const newId = generateDepartmentId(strategyId, dept.name);
  return {
    ...dept,
    id: newId,
  };
}

/**
 * Ensure Project has stable ID
 *
 * If proj.id is missing or invalid, generate it
 * Otherwise return as-is
 */
export function ensureProjectId(
  strategyId: string,
  departmentId: string,
  proj: { id?: string | number; title: string; [key: string]: any },
  laneType: 'existing' | 'new' = 'existing',
): { id: string; [key: string]: any } {
  // If id exists and is non-empty, keep it
  if (proj.id && String(proj.id).trim()) {
    return {
      ...proj,
      id: String(proj.id),
    };
  }

  // Generate id from title and departmentId
  const newId = generateProjectId(strategyId, departmentId, proj.title, laneType);
  return {
    ...proj,
    id: newId,
  };
}

/**
 * Batch ensure IDs for all departments and their projects
 *
 * Process entire department tree in one call
 */
export function ensureAllDepartmentAndProjectIds(
  strategyId: string,
  departments: Array<{ id?: string | number; name: string; projects?: any[]; lanes?: any; [key: string]: any }>,
): Array<{ id: string; [key: string]: any }> {
  return departments.map((dept) => {
    // First, ensure department id
    const deptWithId = ensureDepartmentId(strategyId, dept);
    const deptId = deptWithId.id;

    // Then, ensure all projects (including in lanes) have ids
    if (dept.projects && Array.isArray(dept.projects)) {
      deptWithId.projects = dept.projects.map((proj) =>
        ensureProjectId(strategyId, deptId, proj, 'existing'),
      );
    }

    // Handle lanes structure
    if (dept.lanes && typeof dept.lanes === 'object') {
      if (dept.lanes.existing && Array.isArray(dept.lanes.existing.projects)) {
        deptWithId.lanes = deptWithId.lanes || {};
        deptWithId.lanes.existing = deptWithId.lanes.existing || {};
        deptWithId.lanes.existing.projects = dept.lanes.existing.projects.map((proj) =>
          ensureProjectId(strategyId, deptId, proj, 'existing'),
        );
      }

      if (dept.lanes.new && Array.isArray(dept.lanes.new.projects)) {
        deptWithId.lanes = deptWithId.lanes || {};
        deptWithId.lanes.new = deptWithId.lanes.new || {};
        deptWithId.lanes.new.projects = dept.lanes.new.projects.map((proj) =>
          ensureProjectId(strategyId, deptId, proj, 'new'),
        );
      }
    }

    return deptWithId;
  });
}

export default {
  generateDepartmentId,
  generateProjectId,
  generateStableIdFromSeed,
  ensureDepartmentId,
  ensureProjectId,
  ensureAllDepartmentAndProjectIds,
};
