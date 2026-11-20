/* 承認前に利用者が編集した値を候補へ適用する。候補に無い項目は作らない（出典が無い値を入れないため）。 */
import type { ApplicableCandidate } from './filingCandidates';

export type EditableKey = 'companyName' | 'location' | 'employees' | 'businessContent';

export type CandidateEdits = Partial<Record<EditableKey, string>>;

export const EDITABLE_KEYS: readonly EditableKey[] = ['companyName', 'location', 'employees', 'businessContent'];

/** 従業員数は1以上の整数だけ受け付ける（カンマ・「名」は許す） */
export function isValidEmployeesEdit(raw: string): boolean {
  const v = raw.trim().replace(/[,，名人\s]/g, '');
  return v === '' || /^\d{1,7}$/.test(v) && Number(v) > 0;
}

export function editsAreValid(edits: CandidateEdits): boolean {
  return edits.employees === undefined || isValidEmployeesEdit(edits.employees);
}

/** 編集された値で候補を作り直す。空にした項目は反映しない。無効な従業員数は候補の値のまま */
export function applyCandidateEdits<C extends ApplicableCandidate>(c: C, edits: CandidateEdits): C {
  const fields = { ...c.profile.fields };
  const extra = { ...c.profileExtra };
  if (edits.companyName !== undefined && fields.companyName) {
    const v = edits.companyName.trim();
    if (v === '') delete fields.companyName;
    else fields.companyName = { ...fields.companyName, value: v };
  }
  if (edits.location !== undefined && extra.location) {
    const v = edits.location.trim();
    if (v === '') delete extra.location;
    else extra.location = { ...extra.location, value: v };
  }
  if (edits.businessContent !== undefined && extra.businessContent) {
    const v = edits.businessContent.trim();
    if (v === '') delete extra.businessContent;
    else extra.businessContent = { ...extra.businessContent, value: v };
  }
  if (edits.employees !== undefined && extra.employees) {
    const v = edits.employees.trim().replace(/[,，名人\s]/g, '');
    if (v === '') delete extra.employees;
    else if (isValidEmployeesEdit(edits.employees)) extra.employees = { ...extra.employees, value: Number(v) };
  }
  return { ...c, profile: { ...c.profile, fields }, profileExtra: extra };
}
