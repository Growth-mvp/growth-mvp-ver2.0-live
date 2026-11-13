/** STAGE2の業績目標で選べる単位。選択肢にない単位も、編集で別の単位へ置き換えない */
export const COMPANY_TARGET_UNIT_PRESETS = ['円', '千円', '万円', '百万円', '億円', '%', '件', '人', '回'] as const;

export function isPresetUnit(unit: string): boolean {
  return (COMPANY_TARGET_UNIT_PRESETS as readonly string[]).includes(unit);
}

/** 編集フォームに入れる単位。登録済みの値（選択肢外・未設定を含む）をそのまま使う */
export function editableUnitOf(unit: unknown): string {
  return typeof unit === 'string' ? unit : '';
}
