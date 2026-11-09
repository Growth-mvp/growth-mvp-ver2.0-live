import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { buildPlanContext } from './context';
import { buildExecutionPlanPrompt } from './prompt';
import { buildPlanSource } from './source';

const { source, scope } = buildPlanSource(COMMERCIAL_INPUT);
const prompt = buildExecutionPlanPrompt(buildPlanContext(source, scope));

describe('プロンプト v2（活動と成果・契約・簡潔さ）', () => {
  it('活動と成果を混同しない原則を、例とともに含む', () => {
    expect(prompt).toContain('活動を実施することは目的ではない');
    expect(prompt).toContain('会議を行うことは目的ではない');
    expect(prompt).toContain('記録すること自体は改善ではない');
    expect(prompt).toContain('提案件数を増やすだけでは受注は増えない');
    expect(prompt).toContain('研修を実施するだけでは社員の成果は高まらない');
  });

  it('行動ごとに、障害・検証・変化・測る指標・価値への接続の5点を求める', () => {
    for (const k of ['何が成果を妨げているか', 'その原因を、どう検証するか', 'どの行動によって、状況を変えるか', '何を測れば改善したと判断できるか', 'なぜその改善が、顧客価値や業績につながるか']) {
      expect(prompt).toContain(k);
    }
    expect(prompt).toContain('"mechanism"');
    expect(prompt).toContain('"obstacles"');
  });

  it('根拠のない原因は仮説とし、検証の行動を添えるよう求める', () => {
    expect(prompt).toContain('根拠がない原因は、basis を HYPOTHESIS として示し、検証の行動（verifyBy）を必ず添える');
  });

  it('活動の指標を成果のKPIにしないよう求める', () => {
    expect(prompt).toContain('活動の指標（会議の開催回数、研修の受講数、記録件数など）を、成果のKPI');
  });

  it('確認事項は実行前の重要事項を最大3件に絞り、行動は原則3〜5件とする', () => {
    expect(prompt).toContain('BEFORE_START のものは、実行前に確認する重要事項で、最大3件');
    expect(prompt).toContain('原則3〜5件');
    expect(prompt).toContain('省くのは重複だけ');
  });

  it('財務の入力は配列（role・unit・basis・confirmState）で、算定式に入らない項目は FREE にする', () => {
    expect(prompt).toContain('inputs は配列');
    expect(prompt).toContain('method を "FREE"');
    expect(prompt).toContain('CONVERSION_RATE');
    expect(prompt).toContain('金額（円）そのものは書かない');
  });

  it('利用者の確認済み（USER_CONFIRMED）は、AIが書かないことを明記する', () => {
    expect(prompt).toContain('USER_CONFIRMED は書かない（確認は利用者だけが行う）');
  });

  it('参照IDは角括弧なしで一覧され、説明文では角括弧を付けないよう求める', () => {
    expect(prompt).toContain('- S2-CORE｜');
    expect(prompt).not.toMatch(/- \[S\d/);
    expect(prompt).toContain('角括弧や説明は付けない');
  });

  it('活動と成果の例（作業時間の削減率は成果、記録件数は活動）をプロンプトに含む', () => {
    expect(prompt).toContain('計測・記録に必要な作業時間の削減率');
  });
});
