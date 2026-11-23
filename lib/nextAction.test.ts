import { stage2NextActionLine, stage5NextActionLine } from './nextAction';

const base = { hasDraft: true, hasFinal: false, committed: false, hasPendingDeepDive: false };

describe('stage2NextActionLine', () => {
  it('たたき台がなければ、たたき台の生成を案内する', () => {
    expect(stage2NextActionLine({ ...base, hasDraft: false })).toContain('「たたき台を生成」');
  });

  it('未反映の深掘り回答があれば、反映して生成する操作を案内する', () => {
    expect(stage2NextActionLine({ ...base, hasPendingDeepDive: true })).toContain('「深掘り回答を反映して経営戦略を生成」');
    expect(stage2NextActionLine(base)).toContain('「経営戦略を生成」');
  });

  it('生成済みなら最終確定を案内し、確定済みなら STAGE3 へ進むことを案内する', () => {
    expect(stage2NextActionLine({ ...base, hasFinal: true })).toContain('「最終確定」');
    expect(stage2NextActionLine({ ...base, hasFinal: true, committed: true })).toContain('確定済み');
  });
});

describe('stage5NextActionLine', () => {
  it('プロジェクトがなければ STAGE3 での登録を案内する', () => {
    expect(stage5NextActionLine({ hasProjects: false, hasStartedPlan: false })).toContain('STAGE3');
  });

  it('実行計画が未開始なら STAGE4 を案内し、開始済みなら進捗の記録を案内する', () => {
    expect(stage5NextActionLine({ hasProjects: true, hasStartedPlan: false })).toContain('STAGE4');
    expect(stage5NextActionLine({ hasProjects: true, hasStartedPlan: true })).toContain('進捗と実績を記録');
  });
});
