/**
 * 承認状態が確認できない項目について、承認済みと読める表現を登録状態の表現に置き換える。
 * 承認の有無はデータから判定できないため、目標は常に「承認状態は未確認」として扱う。
 */
const UNAPPROVED_EXPRESSIONS: Array<[RegExp, string]> = [
  [/公式な全社(売上高|売上|営業利益)?目標/g, '登録された全社$1目標'],
  [/公式な(財務|売上|営業利益)?目標/g, '登録された$1目標'],
  [/公式目標として扱/g, '登録目標として扱'],
  [/正式決定済み/g, '登録済み（承認状態は未確認）'],
  [/正式な全社(売上高|売上|営業利益)?目標/g, '登録された全社$1目標'],
  [/正式に承認された目標/g, '承認状態が未確認の目標'],
  [/会社として決定済みの(目標|計画)/g, '登録された$1（承認状態は未確認）'],
  [/確定した経営計画/g, '経営計画'],
];

export function normalizeApprovalWording(text: string): string {
  return UNAPPROVED_EXPRESSIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
