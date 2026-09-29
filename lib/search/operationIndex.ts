import { Operation } from './operationSchema';
import { OPERATIONS } from './operationData';

/**
 * In-memory operation index with caching
 *
 * This module manages the cached operation metadata for fast searching.
 * The cache is populated on first use and can be manually refreshed.
 */

let operationCache: Operation[] | null = null;
let cacheTimestamp: number | null = null;
const CACHE_TTL_MS = 3600000; // 1 hour (configurable via env)

export function getCacheTTL(): number {
  const envTTL = process.env.SEARCH_OPERATIONS_CACHE_TTL;
  if (envTTL) {
    const parsedTTL = parseInt(envTTL, 10);
    if (!isNaN(parsedTTL)) {
      return parsedTTL * 1000; // Convert seconds to ms
    }
  }
  return CACHE_TTL_MS;
}

/**
 * Check if cache is still valid
 */
function isCacheValid(): boolean {
  if (!operationCache || !cacheTimestamp) {
    return false;
  }
  return Date.now() - cacheTimestamp < getCacheTTL();
}

/**
 * Load operations into cache
 */
export async function loadOperationsIntoCache(): Promise<Operation[]> {
  if (isCacheValid() && operationCache) {
    return operationCache;
  }

  try {
    // Use hardcoded operation data from operationData.ts
    operationCache = OPERATIONS;
    cacheTimestamp = Date.now();
    return operationCache;
  } catch (error) {
    console.error('Failed to load operations into cache:', error);
    // Return empty array to prevent breaking search
    return [];
  }
}

/**
 * Get all cached operations
 */
export async function getAllOperations(): Promise<Operation[]> {
  if (!isCacheValid()) {
    await loadOperationsIntoCache();
  }
  return operationCache || [];
}

/**
 * Get operation by ID
 */
export async function getOperationById(id: string): Promise<Operation | null> {
  const ops = await getAllOperations();
  return ops.find(op => op.operationId === id) || null;
}

/**
 * Get operations by screen
 */
export async function getOperationsByScreen(screenName: string): Promise<Operation[]> {
  const ops = await getAllOperations();
  const normalized = screenName.toLowerCase().replace(/\s+/g, '');
  return ops.filter(op =>
    op.screen.toLowerCase().replace(/\s+/g, '').includes(normalized)
  );
}

/**
 * Get operations by category
 */
export async function getOperationsByCategory(category: string): Promise<Operation[]> {
  const ops = await getAllOperations();
  return ops.filter(op => op.category === category);
}

/**
 * Filter operations by permission level
 */
export async function getOperationsByPermission(permission: string): Promise<Operation[]> {
  const ops = await getAllOperations();
  return ops.filter(op => op.permissions.includes(permission as any));
}

/**
 * Filter operations by saving method
 */
export async function getOperationsBySavingMethod(method: string): Promise<Operation[]> {
  const ops = await getAllOperations();
  return ops.filter(op => op.savingMethod === method);
}

/**
 * Get operation statistics
 */
export async function getOperationStats(): Promise<{
  totalCount: number;
  byScreen: Record<string, number>;
  byCategory: Record<string, number>;
  bySavingMethod: Record<string, number>;
}> {
  const ops = await getAllOperations();

  const byScreen: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySavingMethod: Record<string, number> = {};

  for (const op of ops) {
    byScreen[op.screen] = (byScreen[op.screen] || 0) + 1;
    byCategory[op.category] = (byCategory[op.category] || 0) + 1;
    bySavingMethod[op.savingMethod] = (bySavingMethod[op.savingMethod] || 0) + 1;
  }

  return {
    totalCount: ops.length,
    byScreen,
    byCategory,
    bySavingMethod,
  };
}

/**
 * Clear cache (useful for debugging or manual refresh)
 */
export function clearCache(): void {
  operationCache = null;
  cacheTimestamp = null;
}

/**
 * Force reload from source
 */
export async function refreshCache(): Promise<Operation[]> {
  clearCache();
  return loadOperationsIntoCache();
}

/**
 * Get cache status
 */
export function getCacheStatus(): {
  loaded: boolean;
  count: number;
  timestamp: number | null;
  valid: boolean;
} {
  return {
    loaded: operationCache !== null,
    count: operationCache?.length || 0,
    timestamp: cacheTimestamp,
    valid: isCacheValid(),
  };
}
