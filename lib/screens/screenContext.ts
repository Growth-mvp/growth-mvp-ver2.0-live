import { findScreenById, findScreenByPathname, type ScreenArea, type ScreenEntry } from './screenRegistry';

export type ScreenContext = {
  screenId: string;
  pathname: string;
  label: string;
  area: ScreenArea;
  stage?: number;
};

const MAX_PATHNAME_LENGTH = 200;
const MAX_SCREEN_ID_LENGTH = 64;
const PATHNAME_PATTERN = /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

export function normalizePathname(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PATHNAME_LENGTH) return null;
  if (input.includes('//')) return null;
  if (input === '/') return '/';
  const trimmed = input.endsWith('/') ? input.slice(0, -1) : input;
  return PATHNAME_PATTERN.test(trimmed) ? trimmed : null;
}

export function screenIdForPathname(pathname: string): string | null {
  const normalized = normalizePathname(pathname);
  if (!normalized) return null;
  return findScreenByPathname(normalized)?.id ?? null;
}

function toContext(entry: ScreenEntry): ScreenContext {
  return {
    screenId: entry.id,
    pathname: entry.pathname,
    label: entry.label,
    area: entry.area,
    ...(entry.stage !== undefined ? { stage: entry.stage } : {}),
  };
}

export function resolveScreenContext(raw: unknown): ScreenContext | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { screenId } = raw as { screenId?: unknown };
  if (typeof screenId !== 'string' || screenId.length === 0 || screenId.length > MAX_SCREEN_ID_LENGTH) {
    return null;
  }
  const entry = findScreenById(screenId);
  if (!entry || entry.lifecycle === 'undetermined') return null;
  return toContext(entry);
}
