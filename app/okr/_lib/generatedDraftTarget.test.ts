import { isDraftProjectMatch, isDraftTargetSelected } from './generatedDraftTarget';

describe('isDraftTargetSelected', () => {
  it('選択中のプロジェクトと同じ添字のときだけ真', () => {
    expect(isDraftTargetSelected(1, 2, { deptIdx: 1, projIdx: 2 })).toBe(true);
    expect(isDraftTargetSelected(1, 2, { deptIdx: 1, projIdx: 3 })).toBe(false);
    expect(isDraftTargetSelected(0, 2, { deptIdx: 1, projIdx: 2 })).toBe(false);
  });

  it('プロジェクトが未選択なら偽', () => {
    expect(isDraftTargetSelected(0, 0, null)).toBe(false);
  });
});

describe('isDraftProjectMatch', () => {
  it('安定IDが一致するプロジェクトだけ真', () => {
    expect(isDraftProjectMatch('p-1', { id: 'p-1' })).toBe(true);
    expect(isDraftProjectMatch('p-1', { id: 'p-2' })).toBe(false);
    expect(isDraftProjectMatch('p-1', { id: '' })).toBe(false);
    expect(isDraftProjectMatch('p-1', {})).toBe(false);
  });

  it('安定IDのない草案は添字の判定に任せる（旧データ）', () => {
    expect(isDraftProjectMatch('', { id: 'p-9' })).toBe(true);
    expect(isDraftProjectMatch('', {})).toBe(true);
  });

  it('プロジェクトが無ければ偽', () => {
    expect(isDraftProjectMatch('p-1', undefined)).toBe(false);
    expect(isDraftProjectMatch('', null)).toBe(false);
  });
});
