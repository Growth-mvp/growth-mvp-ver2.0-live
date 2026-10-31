export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
  '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
] as const;

export const OVERSEAS_LOCATION = '海外';
const OVERSEAS_DETAIL_MAX = 100;
const OVERSEAS_PATTERN = /^海外[:：]([\s\S]*)$/;

export type HeadquartersLocation =
  | { kind: 'unset' }
  | { kind: 'prefecture'; prefecture: string }
  | { kind: 'overseas'; detail: string }
  | { kind: 'legacy'; raw: string };

/** 保存値（strategy_data.location）を解釈する。既存の自由記述は legacy として元の文字列を保つ */
export function parseHeadquartersLocation(value: string | null | undefined): HeadquartersLocation {
  const text = value ?? '';
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'unset' };
  if ((PREFECTURES as readonly string[]).includes(trimmed)) return { kind: 'prefecture', prefecture: trimmed };
  if (trimmed === OVERSEAS_LOCATION) return { kind: 'overseas', detail: '' };
  const overseas = text.replace(/^\s+/, '').match(OVERSEAS_PATTERN);
  if (overseas) return { kind: 'overseas', detail: overseas[1].replace(/^\s+/, '') };
  return { kind: 'legacy', raw: text };
}

export function formatHeadquartersLocation(loc: HeadquartersLocation): string {
  switch (loc.kind) {
    case 'unset':
      return '';
    case 'prefecture':
      return loc.prefecture;
    case 'overseas': {
      const detail = loc.detail.slice(0, OVERSEAS_DETAIL_MAX);
      return detail.trim() ? `${OVERSEAS_LOCATION}：${detail}` : OVERSEAS_LOCATION;
    }
    case 'legacy':
      return loc.raw;
  }
}

export const EMPLOYEE_BANDS = [
  { value: '1〜19', label: '1〜19名' },
  { value: '20〜49', label: '20〜49名' },
  { value: '50〜99', label: '50〜99名' },
  { value: '100〜299', label: '100〜299名' },
  { value: '300〜999', label: '300〜999名' },
  { value: '1000以上', label: '1,000名以上' },
] as const;

/** 保存値を表示用の文言にする。人数帯以外（既存の人数値など）は変換せずそのまま返す */
export function employeeDisplayLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const band = EMPLOYEE_BANDS.find((b) => b.value === raw);
  return band ? band.label : raw;
}
