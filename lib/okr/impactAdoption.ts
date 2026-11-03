/* AI草案の効果額を、利用者が「反映」したときに施策のどの欄へ入れるかを決める。 */

export type ImpactRoleKey = 'REVENUE' | 'COST' | 'FUTURE';

export type ImpactField = 'impactRevenueMJPY' | 'impactOpIncomeMJPY' | 'impactInvestmentMJPY';

export const IMPACT_FIELD_BY_ROLE: Record<ImpactRoleKey, ImpactField> = {
  REVENUE: 'impactRevenueMJPY',
  COST: 'impactOpIncomeMJPY',
  FUTURE: 'impactInvestmentMJPY',
};

const DRAFT_KEY_BY_ROLE: Record<ImpactRoleKey, 'revenueMJPY' | 'opIncomeMJPY' | 'investmentMJPY'> = {
  REVENUE: 'revenueMJPY',
  COST: 'opIncomeMJPY',
  FUTURE: 'investmentMJPY',
};

export type ImpactAdoption =
  | { kind: 'adoptable'; field: ImpactField; value: number }
  | { kind: 'already_set'; field: ImpactField; current: unknown }
  | { kind: 'no_role_field' }
  | { kind: 'no_value' };

export function adoptableImpact(args: {
  role: string | null | undefined;
  draftImpact: Record<string, unknown> | null | undefined;
  calculatedValue: number | null | undefined;
  current: Record<string, unknown> | null | undefined;
}): ImpactAdoption {
  const role = args.role as ImpactRoleKey | undefined;
  if (!role || !(role in IMPACT_FIELD_BY_ROLE)) return { kind: 'no_role_field' };

  const field = IMPACT_FIELD_BY_ROLE[role];
  const current = args.current?.[field];
  if (current) return { kind: 'already_set', field, current };

  const draftValue = args.draftImpact?.[DRAFT_KEY_BY_ROLE[role]];
  const value = args.calculatedValue ?? (typeof draftValue === 'number' ? draftValue : null);
  if (value === null || value === undefined || !Number.isFinite(value)) return { kind: 'no_value' };

  return { kind: 'adoptable', field, value };
}
