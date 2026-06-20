/**
 * 期限表示の日本語フォーマット
 * "2026-09" → "2026年9月末"
 */
export function formatDeadlineLabel(value?: string | null): string {
  if (!value || typeof value !== 'string') return '期限未設定';

  const trimmed = value.trim();
  if (!trimmed) return '期限未設定';

  // YYYY-MM形式の解析
  const match = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);

    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
      return `${year}年${month}月末`;
    }
  }

  // YYYY形式の場合
  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 1900 && year <= 2100) {
      return `${year}年度末`;
    }
  }

  return '期限未設定';
}

/**
 * KPI名から冗長な接頭辞を削除（表示用）
 * "半導体企業向け製品強化：売上向上（%）" + theme="半導体企業向け製品強化"
 * → "売上向上"
 */
export function normalizeKpiTitle(title: string, theme?: string): string {
  if (!title) return '';

  const trimmedTitle = title.trim();

  if (theme) {
    const trimmedTheme = theme.trim();
    // テーマ名が接頭辞として含まれている場合、それを削除
    if (trimmedTitle.startsWith(trimmedTheme + '：')) {
      const rest = trimmedTitle.slice(trimmedTheme.length + 1).trim();
      return rest;
    }
    if (trimmedTitle.startsWith(trimmedTheme + ':')) {
      const rest = trimmedTitle.slice(trimmedTheme.length + 1).trim();
      return rest;
    }
  }

  return trimmedTitle;
}

/**
 * プロジェクト名・戦略テーマ名のプレフィックスを削除（表示用）
 * "電力関連会社向けのエネルギー管理システム：売上向上（%）"
 * → "売上向上（%）"
 *
 * 既存データが「テーマ名：KPI名」形式の場合、表示時のみプレフィックスを削除する
 * 保存データは変更しない
 */
export function stripProjectPrefix(text: string): string {
  const t = String(text ?? '').trim();
  // 「テーマ名：KPI名」の形式の場合、コロンの後ろの部分を取得
  if (t.includes('：')) {
    const parts = t.split('：');
    return parts.slice(1).join('：').trim();
  }
  return t;
}

/**
 * 今月から指定月数後の YYYY-MM を生成
 * @param monthsFromNow 今月から何か月後か（デフォルト3）
 */
export function generateFutureDeadline(monthsFromNow: number = 3): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  let targetMonth = month + monthsFromNow;
  let targetYear = year;

  while (targetMonth > 12) {
    targetMonth -= 12;
    targetYear += 1;
  }

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
}

/**
 * 指定された期限が過去かどうかを判定
 */
export function isPastDeadline(deadline?: string | null): boolean {
  if (!deadline || typeof deadline !== 'string') return false;

  const match = deadline.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) return true;
  if (year === currentYear && month < currentMonth) return true;

  return false;
}
