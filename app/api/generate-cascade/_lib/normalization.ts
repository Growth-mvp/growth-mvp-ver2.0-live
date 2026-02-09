/**
 * _lib/normalization.ts
 * Project normalization functions
 */

import { NormProject } from './types';

/**
 * ★ FIX: KeyResult を文字列に統一変換
 * - string はそのまま
 * - object は text/label/name/title/value の優先順で抽出
 * - その他は JSON.stringify を避け、空文字→除外
 */
export function toKeyResultText(kr: any): string {
  if (typeof kr === 'string') return kr.trim();
  if (!kr || typeof kr !== 'object') return '';

  const candidates = [
    kr.text,
    kr.label,
    kr.name,
    kr.title,
    kr.value,
    kr.description,
  ];

  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }

  return '';
}

/**
 * ★ FIX: OKR.keyResults を string[] に正規化
 */
export function normalizeOkr(okr: any): any {
  if (!okr || typeof okr !== 'object') return okr;

  const normalized = { ...okr };

  // keyResults を string[] に統一
  if (Array.isArray(okr.keyResults)) {
    normalized.keyResults = okr.keyResults
      .map(toKeyResultText)
      .filter(Boolean);
  }

  return normalized;
}

/**
 * 部門seed projects（string[]/object[] 混在）を string[] に正規化
 */
export function normalizeProjectSeeds(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') return String(p.title ?? p.name ?? '').trim();
      return '';
    })
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * プロジェクトデータを正規化（型チェック付き）
 * ★ FIX: OKRs を保持（削除しない）
 */
export function normalizeProjects(raw: any): NormProject[] {
  const list = Array.isArray(raw) ? raw : [];
  const allowedLevers = ['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE'] as const;
  const allowedHorizons = ['short', 'mid', 'long'] as const;
  const allowedKinds = ['growth', 'cost', 'efficiency', 'future'] as const;

  return list
    .filter((p: any) => typeof p?.title === 'string' && p.title.trim().length > 0)
    .map((p: any) => {
      const title = p.title.trim();
      const reason = typeof p?.reason === 'string' ? p.reason.trim() : undefined;
      const hypothesis = typeof p?.hypothesis === 'string' ? p.hypothesis.trim() : undefined;

      const mainLeverRaw = typeof p?.mainLever === 'string' ? p.mainLever.trim().toUpperCase() : '';
      const mainLever = allowedLevers.includes(mainLeverRaw as any)
        ? (mainLeverRaw as NormProject['mainLever'])
        : undefined;

      const horizonRaw = typeof p?.horizon === 'string' ? p.horizon.trim().toLowerCase() : '';
      const horizon = allowedHorizons.includes(horizonRaw as any)
        ? (horizonRaw as NormProject['horizon'])
        : undefined;

      const kindRaw = typeof p?.kind === 'string' ? p.kind.trim().toLowerCase() : '';
      const kind = allowedKinds.includes(kindRaw as any) ? (kindRaw as NormProject['kind']) : undefined;

      const normalized: any = { title, reason, hypothesis, mainLever, horizon, kind };

      // ★ FIX: OKRs を保持しつつ keyResults を string[] に正規化
      if (Array.isArray(p?.okrs)) {
        normalized.okrs = p.okrs.map(normalizeOkr);
      }
      if (Array.isArray(p?.keyResults)) {
        normalized.keyResults = p.keyResults
          .map(toKeyResultText)
          .filter(Boolean);
      }

      return normalized;
    });
}
