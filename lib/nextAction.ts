export function stage2NextActionLine(s: {
  hasDraft: boolean;
  hasFinal: boolean;
  committed: boolean;
  hasPendingDeepDive: boolean;
}): string {
  if (s.committed) return '確定済みです。次は STAGE3 で部門ごとの戦略を作成してください。';
  if (!s.hasDraft) return '次の操作：「たたき台を生成」を押してください。';
  if (!s.hasFinal) {
    return s.hasPendingDeepDive
      ? '次の操作：「戦略議論」で「深掘り回答を反映して経営戦略を生成」を押してください。'
      : '次の操作：「戦略議論」で「経営戦略を生成」を押してください。';
  }
  return '次の操作：「最終確定」で内容を確認し、「全社戦略を確定し、STAGE3へ引き渡す」を押してください。';
}

export function stage5NextActionLine(s: { hasProjects: boolean; hasStartedPlan: boolean }): string {
  if (!s.hasProjects) return '次の操作：STAGE3でプロジェクトを登録してください。';
  if (!s.hasStartedPlan) return '次の操作：STAGE4で実行計画を開始すると、ここで進捗と実績を記録できます。';
  return '次の操作：一覧からプロジェクトを選び、進捗と実績を記録してください。';
}
