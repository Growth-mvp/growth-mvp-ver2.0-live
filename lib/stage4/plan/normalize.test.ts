import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { runExecutionPlanEngine } from './generate';
import { normalizeKnownDrift } from './normalize';

const golden = () => JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT));
const errorsOf = (r: { issues: Array<{ severity: string; code: string }> }) =>
  r.issues.filter((i) => i.severity === 'error').map((i) => i.code);

describe('normalizeKnownDrift（既知の余分な項目の除外）', () => {
  it('section1.problemCause.verifyBy の文字列だけを取り除き、取り除いた内容を記録する', () => {
    const d = golden();
    d.section1.problemCause.verifyBy = '原因の検証方法';
    const { json, applied } = normalizeKnownDrift(d);
    expect((json as any).section1.problemCause).not.toHaveProperty('verifyBy');
    expect(applied).toEqual([{ path: 'section1.problemCause', key: 'verifyBy', removed: '原因の検証方法' }]);
    expect(d.section1.problemCause).toHaveProperty('verifyBy');
  });

  it('対象の場所以外の verifyBy は、取り除かない', () => {
    const d = golden();
    d.section1.customerProblem.verifyBy = 'x';
    d.section1.obstacles[0].verifyBy = 'y';
    const { json, applied } = normalizeKnownDrift(d);
    expect(applied).toEqual([]);
    expect((json as any).section1.customerProblem).toHaveProperty('verifyBy', 'x');
    expect((json as any).section1.obstacles[0]).toHaveProperty('verifyBy', 'y');
  });

  it('文字列でない verifyBy は、取り除かない（検証エラーのまま残す）', () => {
    const d = golden();
    d.section1.problemCause.verifyBy = { text: 'x' };
    const { json, applied } = normalizeKnownDrift(d);
    expect(applied).toEqual([]);
    expect((json as any).section1.problemCause).toHaveProperty('verifyBy');
  });

  it('対象がなければ、入力をそのまま返す', () => {
    const d = golden();
    const { json, applied } = normalizeKnownDrift(d);
    expect(applied).toEqual([]);
    expect(json).toBe(d);
  });
});

describe('runExecutionPlanEngine（正規化の記録と、元の応答の保持）', () => {
  it('verifyBy が1つあるだけなら、検証を通り、正規化の事実が記録される', async () => {
    const d = golden();
    d.section1.problemCause.verifyBy = '原因の検証方法';
    const text = JSON.stringify(d);
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: async () => text });
    expect(r.ok).toBe(true);
    expect(errorsOf(r)).toEqual([]);
    expect(r.normalizations).toEqual([{ path: 'section1.problemCause', key: 'verifyBy', removed: '原因の検証方法' }]);
    expect(r.issues.map((i) => i.code)).toContain('SHAPE_NORMALIZED');
    expect(r.rawOutput).toBe(text);
  });

  it('対象外の余分な項目が1つでもあれば、従来どおり SCHEMA_INVALID で止まる', async () => {
    const d = golden();
    d.section1.problemCause.verifyBy = '原因の検証方法';
    d.section1.problemCause.extra = 'x';
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: async () => JSON.stringify(d) });
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toEqual(['SCHEMA_INVALID']);
    expect(r.normalizations).toHaveLength(1);
  });

  it('対象外の場所の余分な項目は、正規化されず SCHEMA_INVALID になる', async () => {
    const d = golden();
    d.section1.customerProblem.verifyBy = 'x';
    const r = await runExecutionPlanEngine({ raw: COMMERCIAL_INPUT, callModel: async () => JSON.stringify(d) });
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toEqual(['SCHEMA_INVALID']);
    expect(r.normalizations).toEqual([]);
  });
});
