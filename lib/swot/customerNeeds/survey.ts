/** 公開調査の記録。取得できない項目は null のまま残し、推測で埋めない */
export type SurveyRecord = {
  sourceUrl: string;
  publisher: string | null;
  fieldPeriod: string | null;
  population: string | null;
  sampleSize: number | null;
  region: string | null;
  questionSummary: string | null;
  /** 調査対象と当該企業の顧客との関係 */
  customerRelation: 'same_customer' | 'adjacent' | 'different' | 'unknown';
  /** 出典の本文を確認したか。URL があるだけでは false */
  bodyChecked: boolean;
};

export type SurveyAssessment = {
  usableAsCustomerEvidence: boolean;
  unverified: string[];
};

export function assessSurvey(r: SurveyRecord): SurveyAssessment {
  const unverified: string[] = [];
  if (!r.bodyChecked) unverified.push('source_body_not_checked');
  if (!r.publisher) unverified.push('publisher');
  if (!r.fieldPeriod) unverified.push('field_period');
  if (!r.population) unverified.push('population');
  if (r.sampleSize === null) unverified.push('sample_size');
  if (!r.region) unverified.push('region');
  if (r.customerRelation === 'unknown') unverified.push('customer_relation_unconfirmed');
  if (r.customerRelation === 'adjacent') unverified.push('customer_relation_adjacent');
  if (r.customerRelation === 'different') unverified.push('customer_relation_different');
  const usable =
    r.bodyChecked &&
    r.customerRelation === 'same_customer' &&
    !!r.population &&
    !!r.fieldPeriod &&
    r.sampleSize !== null;
  return { usableAsCustomerEvidence: usable, unverified };
}
