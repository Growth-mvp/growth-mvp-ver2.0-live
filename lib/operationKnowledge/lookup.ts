import { findScreenById } from '@/lib/screens/screenRegistry';
import { OPERATIONS, type OperationEntry } from './operations';

const BY_ID = new Map(OPERATIONS.map((op) => [op.operationId, op] as const));

export function getOperation(operationId: string): OperationEntry | null {
  return BY_ID.get(operationId) ?? null;
}

export function isOperationScreenEligible(screenId: string): boolean {
  const screen = findScreenById(screenId);
  return screen !== null && screen.lifecycle !== 'undetermined';
}

export function getOperationsForScreen(screenId: string): OperationEntry[] {
  if (!isOperationScreenEligible(screenId)) return [];
  return OPERATIONS.filter((op) => op.screenIds.length === 0 || op.screenIds.includes(screenId));
}

export function isGuidanceEnabled(screenId: string): boolean {
  const screen = findScreenById(screenId);
  return screen !== null && screen.helpEnabled === true && isOperationScreenEligible(screenId);
}
