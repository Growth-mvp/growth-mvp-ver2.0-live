/**
 * 新方式（顧客課題の発見）の購入者抽出。STAGE1 の顧客欄から、実在の購入者を事業をまたいで整理する。
 * - 分割は「、」「，」のみ（「・」は名称の一部として残す）
 * - 社内組織（会社名を含む表記）は購入者にしない。会社名が無いときは抽出しない（不明）
 * - 具体性のない表記（「企業」「法人顧客」など）は購入者にしない
 * - 同じ表記は1人に統合し、どの事業から来たかを残す
 */

export type BuyerSegmentInput = { name: string; keyCustomers: readonly string[] };

export type Buyer = { ref: number; label: string; segments: string[] };

export type ExcludedLabel = {
  label: string;
  segment: string;
  reason: 'empty' | 'internal' | 'generic';
};

export type BuyerExtraction =
  | { status: 'ok'; buyers: Buyer[]; excluded: ExcludedLabel[] }
  | { status: 'no_company_name'; buyers: []; excluded: [] };

const GENERIC_KEYS = new Set([
  '企業',
  '法人',
  '法人顧客',
  '個人',
  '個人顧客',
  '一般',
  '一般の方',
  '顧客',
  '会社',
  '団体',
  '組織',
  'その他',
]);

/** 比較用の表記（株式会社・空白・末尾の「等」を除き、大文字小文字をそろえる） */
export function normalizeBuyerKey(s: string): string {
  return s
    .replace(/株式会社/g, '')
    .replace(/[\s　]/g, '')
    .replace(/等$/, '')
    .toLowerCase();
}

export function extractBuyers(segments: readonly BuyerSegmentInput[], companyName: string | undefined): BuyerExtraction {
  const companyKey = normalizeBuyerKey(companyName ?? '');
  if (!companyKey) return { status: 'no_company_name', buyers: [], excluded: [] };

  const byKey = new Map<string, Buyer>();
  const excluded: ExcludedLabel[] = [];

  for (const seg of segments) {
    for (const raw of seg.keyCustomers) {
      for (const part of raw.split(/[、，]/)) {
        const label = part.trim();
        const key = normalizeBuyerKey(label);
        if (!key) {
          excluded.push({ label, segment: seg.name, reason: 'empty' });
          continue;
        }
        if (key.includes(companyKey)) {
          excluded.push({ label, segment: seg.name, reason: 'internal' });
          continue;
        }
        if (GENERIC_KEYS.has(key)) {
          excluded.push({ label, segment: seg.name, reason: 'generic' });
          continue;
        }
        const hit = byKey.get(key);
        if (hit) {
          if (!hit.segments.includes(seg.name)) hit.segments.push(seg.name);
        } else {
          byKey.set(key, { ref: 0, label, segments: [seg.name] });
        }
      }
    }
  }

  const buyers = [...byKey.values()].map((b, i) => ({ ...b, ref: i + 1 }));
  return { status: 'ok', buyers, excluded };
}
