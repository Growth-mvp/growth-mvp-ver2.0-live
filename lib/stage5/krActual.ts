/* STAGE5：KR実績の記録・照合（純粋関数）。KRの特定は一意なIDだけで行い、配列の位置やラベルでは探さない。 */
import type { KRStructured, KrActual } from '@/types/strategy';

export const KR_ACTUAL_NOTE_MAX = 500;
const ASOF_PATTERN = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

export type KrLocateReason = 'missing-id' | 'not-found' | 'ambiguous';
export type KrLocate = { ok: true; index: number } | { ok: false; reason: KrLocateReason };

export function locateKrById(okrsV2: unknown, krId: unknown): KrLocate {
  if (typeof krId !== 'string' || krId.trim() === '') return { ok: false, reason: 'missing-id' };
  const list: any[] = Array.isArray(okrsV2) ? okrsV2 : [];
  const hits: number[] = [];
  list.forEach((k, i) => {
    if (k && typeof k.id === 'string' && k.id === krId) hits.push(i);
  });
  if (hits.length === 0) return { ok: false, reason: 'not-found' };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, index: hits[0] };
}

export function krLocateMessage(reason: KrLocateReason): string {
  if (reason === 'missing-id') return 'このKRには識別子（ID）がないため、実績を記録できません。STAGE4でKRを保存し直してください。';
  if (reason === 'ambiguous') return '同じIDのKRが複数あるため、対象を特定できません。記録は行いませんでした。';
  return '対象のKRが見つからないため、記録は行いませんでした。画面を再読み込みしてから、もう一度お試しください。';
}

export type KrActualInput = { value: unknown; asOf: unknown; note?: unknown };

export function parseKrActualInput(
  raw: KrActualInput,
  nowIso: string,
): { ok: true; actual: KrActual } | { ok: false; error: string } {
  const valueText = typeof raw.value === 'number' ? String(raw.value) : typeof raw.value === 'string' ? raw.value.trim() : '';
  if (valueText === '') return { ok: false, error: '実績値を入力してください。' };
  const value = Number(valueText);
  if (!Number.isFinite(value)) return { ok: false, error: '実績値は数値で入力してください。' };

  const asOf = typeof raw.asOf === 'string' ? raw.asOf.trim() : '';
  if (!ASOF_PATTERN.test(asOf)) return { ok: false, error: '基準日は YYYY-MM または YYYY-MM-DD で入力してください。' };

  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (note.length > KR_ACTUAL_NOTE_MAX) return { ok: false, error: `補足は${KR_ACTUAL_NOTE_MAX}文字以内で入力してください。` };

  return {
    ok: true,
    actual: { value, asOf, recordedAt: nowIso, ...(note ? { note } : {}) },
  };
}

/** 記録：対象KRの actual を置き換える。上書きされる直前の実績は actualHistory に残す（削除しない）。他のKRと他の項目は変えない。 */
export function recordKrActual(
  okrsV2: unknown,
  krId: unknown,
  actual: KrActual,
): { ok: true; next: KRStructured[]; replaced: KrActual | undefined } | { ok: false; reason: KrLocateReason } {
  const loc = locateKrById(okrsV2, krId);
  if (!loc.ok) return loc;
  const list = okrsV2 as KRStructured[];
  const kr = list[loc.index];
  const previous = kr.actual;
  const history = previous ? [...(kr.actualHistory ?? []), previous] : kr.actualHistory;
  const updated: KRStructured = {
    ...kr,
    actual,
    ...(history && history.length > 0 ? { actualHistory: history } : {}),
  };
  return { ok: true, next: list.map((k, i) => (i === loc.index ? updated : k)), replaced: previous };
}

/** 保存に失敗したときの巻き戻し。対象KRの実績と履歴だけを記録前の値に戻す（他のKRと他の項目は変えない）。 */
export function revertKrActual(
  okrsV2: unknown,
  krId: string,
  before: Pick<KRStructured, 'actual' | 'actualHistory'>,
): KRStructured[] | null {
  const loc = locateKrById(okrsV2, krId);
  if (!loc.ok) return null;
  const list = okrsV2 as KRStructured[];
  const kr = list[loc.index];
  const restored: KRStructured = { ...kr };
  if (before.actual) restored.actual = before.actual;
  else delete restored.actual;
  if (before.actualHistory && before.actualHistory.length > 0) restored.actualHistory = before.actualHistory;
  else delete restored.actualHistory;
  return list.map((k, i) => (i === loc.index ? restored : k));
}

/** 読込時の検査。構造が不正な実績は採用しない（推測で補正しない）。 */
export function sanitizeKrActual(raw: unknown): KrActual | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return undefined;
  if (typeof r.asOf !== 'string' || !ASOF_PATTERN.test(r.asOf)) return undefined;
  if (typeof r.recordedAt !== 'string' || r.recordedAt.length === 0) return undefined;
  const note = typeof r.note === 'string' && r.note.trim() !== '' ? r.note.trim().slice(0, KR_ACTUAL_NOTE_MAX) : undefined;
  return { value: r.value, asOf: r.asOf, recordedAt: r.recordedAt, ...(note ? { note } : {}) };
}

export function sanitizeKrActualHistory(raw: unknown): KrActual[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map(sanitizeKrActual).filter((x): x is KrActual => x !== undefined);
  return out.length > 0 ? out : undefined;
}

export type KrActualView =
  | { status: 'unrecorded'; targetText: string }
  | {
      status: 'recorded';
      targetText: string;
      actualText: string;
      diffText: string;
      asOf: string;
      recordedAt: string;
      note?: string;
      historyCount: number;
    };

const signed = (n: number) => {
  const rounded = Math.round(n * 100) / 100;
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return '0';
};

/** 目標と実績の並べ表示用。差は「実績−目標」（同じ単位）。%の差はポイントとして表す。 */
export function krActualView(kr: KRStructured): KrActualView {
  const unit = String(kr.unit ?? '');
  const target = typeof kr.target === 'number' && Number.isFinite(kr.target) ? kr.target : undefined;
  const hasTarget = target !== undefined;
  const targetText = hasTarget ? `${target} ${unit}`.trim() : '目標未設定';
  if (!kr.actual) return { status: 'unrecorded', targetText };
  const diffUnit = unit === '%' ? 'ポイント' : unit;
  return {
    status: 'recorded',
    targetText,
    actualText: `${kr.actual.value} ${unit}`.trim(),
    diffText: hasTarget ? `${signed(kr.actual.value - target)}${diffUnit}` : '目標未設定のため差を算出できない',
    asOf: kr.actual.asOf,
    recordedAt: kr.actual.recordedAt,
    ...(kr.actual.note ? { note: kr.actual.note } : {}),
    historyCount: kr.actualHistory?.length ?? 0,
  };
}
