/* 日付の基準は日本時間（Asia/Tokyo）で統一する。端末や実行環境の時刻帯には依存しない。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstFields(ms: number) {
  const d = new Date(ms + JST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 日本時間の日付（YYYY-MM-DD） */
export function jstDateOf(now: Date): string {
  const f = jstFields(now.getTime());
  return `${f.year}-${pad(f.month)}-${pad(f.day)}`;
}

/** 同じ日かどうかの判定に使う、日本時間の日付キー */
export function jstDayKey(nowMs: number): string {
  return jstDateOf(new Date(nowMs));
}

/** 表示用の点検日時（例：2027年6月15日 9時05分（日本時間））。解釈できなければ null */
export function jstDateTimeLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const f = jstFields(ms);
  return `${f.year}年${f.month}月${f.day}日 ${f.hour}時${pad(f.minute)}分（日本時間）`;
}
