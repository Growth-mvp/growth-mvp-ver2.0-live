import { buildWebProfileCandidate } from './publicCandidate';
import { applyCandidateEdits, editsAreValid, isValidEmployeesEdit } from './candidateEdits';

const built = buildWebProfileCandidate({
  query: '株式会社サンプル製作所',
  facts: [
    { text: '会社名: 株式会社サンプル製作所', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] },
    { text: '所在地: 東京都千代田区1-1-1', sources: [{ title: '会社概要', url: 'https://sample.co.jp/company' }] },
    { text: '従業員数: 120名', sources: [{ title: '採用', url: 'https://sample.co.jp/recruit' }] },
  ],
  confirmedOn: '2026-11-20',
});
if (built.status !== 'FOUND') throw new Error('fixture');
const C = built.candidate;

describe('承認前の候補の編集', () => {
  it('編集した値で候補を作り直し、出典（URL・確認日）は元の項目のまま残す', () => {
    const e = applyCandidateEdits(C, { location: '大阪府大阪市1-1', employees: '150' });
    expect(e.profileExtra.location).toMatchObject({ value: '大阪府大阪市1-1', source: { url: 'https://sample.co.jp/company', confirmedOn: '2026-11-20' } });
    expect(e.profileExtra.employees).toMatchObject({ value: 150, source: { url: 'https://sample.co.jp/recruit' } });
    expect(C.profileExtra.location?.value).toBe('東京都千代田区1-1-1');
  });

  it('空にした項目は反映しない（候補から外す）', () => {
    const e = applyCandidateEdits(C, { location: '  ' });
    expect(e.profileExtra.location).toBeUndefined();
  });

  it('候補に無い項目は、編集してもつくらない（出典の無い値を入れない）', () => {
    const e = applyCandidateEdits(C, { businessContent: '事業内容を手入力' });
    expect(e.profileExtra.businessContent).toBeUndefined();
  });

  it('従業員数は1以上の整数だけ有効。無効な入力では候補の値を保ち、承認を止める', () => {
    expect(isValidEmployeesEdit('1,200名')).toBe(true);
    expect(isValidEmployeesEdit('多数')).toBe(false);
    expect(isValidEmployeesEdit('0')).toBe(false);
    expect(editsAreValid({ employees: '多数' })).toBe(false);
    const e = applyCandidateEdits(C, { employees: '多数' });
    expect(e.profileExtra.employees?.value).toBe(120);
  });
});
