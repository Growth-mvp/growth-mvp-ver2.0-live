/* モデル出力の既知の余分な項目だけを、スキーマ検証の前に取り除く、または安全に短くする。
 * 対象は次の3つに限る：
 *   - section1.problemCause の verifyBy（文字列のときだけ取り除く）
 *   - section2.actions[i].mechanism の verifyBy（行動の因果。検証方法は obstacles に書く）
 *   - section2.actions[i].title（80文字を超える場合だけ、区切りで短くする）
 * 他の余分な項目と不足項目は、そのまま検証エラーにする。
 * 取り除いた値は、正規化の記録として返す（診断・ログ用）。 */

export type Normalization = {
  path: string;
  key: string;
  removed: string;
};

const ACTION_TITLE_MAX = 80;
const TITLE_BREAKS = ['、', '。', '，', '；', '・', '（'];
const TITLE_MIN_KEEP = 20;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function fitUtf16(s: string, limit: number): string {
  let h = s;
  while (h.length > limit) h = Array.from(h).slice(0, -1).join('');
  return h;
}

/* 80文字を超える実施事項のタイトルを、後ろの区切り（読点・句点など）で短くする。区切りが無ければ末尾を「…」にする */
export function shortenActionTitle(title: string): { text: string; removed: string } {
  if (title.length <= ACTION_TITLE_MAX) return { text: title, removed: '' };
  const chars = Array.from(title);
  let cut = -1;
  for (let i = Math.min(chars.length, ACTION_TITLE_MAX) - 1; i >= TITLE_MIN_KEEP; i--) {
    if (TITLE_BREAKS.includes(chars[i])) {
      cut = i;
      break;
    }
  }
  const head = cut >= 0 ? fitUtf16(chars.slice(0, cut).join(''), ACTION_TITLE_MAX) : fitUtf16(chars.slice(0, ACTION_TITLE_MAX - 1).join(''), ACTION_TITLE_MAX - 1);
  const text = cut >= 0 ? head.replace(/\s+$/, '') : `${head}…`;
  return { text, removed: title.slice(head.length) };
}

export function normalizeKnownDrift(json: unknown): { json: unknown; applied: Normalization[] } {
  if (!isObject(json)) return { json, applied: [] };
  const applied: Normalization[] = [];
  let out: Record<string, unknown> = json;

  const section1 = out.section1;
  if (isObject(section1) && isObject(section1.problemCause) && typeof section1.problemCause.verifyBy === 'string') {
    const { verifyBy, ...problemCause } = section1.problemCause;
    applied.push({ path: 'section1.problemCause', key: 'verifyBy', removed: String(verifyBy) });
    out = { ...out, section1: { ...section1, problemCause } };
  }

  const section2 = out.section2;
  if (isObject(section2) && Array.isArray(section2.actions)) {
    let changed = false;
    const actions = section2.actions.map((action: unknown, i: number) => {
      if (!isObject(action)) return action;
      let next: Record<string, unknown> = action;
      if (isObject(next.mechanism) && typeof next.mechanism.verifyBy === 'string') {
        const { verifyBy, ...mechanism } = next.mechanism;
        applied.push({ path: `section2.actions[${i}].mechanism`, key: 'verifyBy', removed: String(verifyBy) });
        next = { ...next, mechanism };
        changed = true;
      }
      if (typeof next.title === 'string' && next.title.length > ACTION_TITLE_MAX) {
        const short = shortenActionTitle(next.title);
        applied.push({ path: `section2.actions[${i}]`, key: 'title', removed: short.removed });
        next = { ...next, title: short.text };
        changed = true;
      }
      return next;
    });
    if (changed) out = { ...out, section2: { ...section2, actions } };
  }

  return { json: out, applied };
}
