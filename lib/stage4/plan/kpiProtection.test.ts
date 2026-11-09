import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { kpiBasisOf, splitKpisByBasis } from './kpiBasis';
import { buildPlanContext } from './context';
import { buildExecutionPlanPrompt } from './prompt';
import { protectedKpisOf } from './assemble';
import { buildPlanSource, type RawPlanInput } from './source';

const PROJECT_ID = 'fx-proj-renovation';

function withKpis(kpis: Array<Record<string, unknown>>): RawPlanInput {
  const raw = structuredClone(COMMERCIAL_INPUT) as unknown as RawPlanInput;
  for (const d of (raw.strategy as unknown as { departments: Array<{ projects: Array<{ id: string; okrsV2?: unknown }> }> }).departments) {
    for (const p of d.projects) {
      if (p.id === PROJECT_ID) p.okrsV2 = kpis;
    }
  }
  return raw;
}

function ctxOf(raw: RawPlanInput) {
  const { source, scope } = buildPlanSource(raw);
  return buildPlanContext(source, scope);
}

const confirmed = { id: 'k-confirmed', label: '改装提案を出した商業施設数', target: 3, unit: '件', due: '2027-02', owner: '田村 誠（仮）', targetBasis: 'USER_CONFIRMED' };
const unknown = { id: 'k-unknown', label: '提案から改装の要否決定までの日数', target: 30, unit: '日', due: '2027-05', owner: null };
const aiProvisional = { id: 'k-ai', label: '動線分析の実施件数', target: 12, unit: '件', due: '2027-03', owner: null, targetBasis: 'AI_PROVISIONAL' };
const zeroTarget = { id: 'k-zero', label: '未対応の苦情件数', target: 0, unit: '件', due: '2027-04', owner: null };

describe('KPIの根拠の判定（kpiBasisOf）', () => {
  it('利用者の確定だけを USER_CONFIRMED とする', () => {
    expect(kpiBasisOf({ targetBasis: 'USER_CONFIRMED' })).toBe('USER_CONFIRMED');
  });

  it('AIの仮の値は AI_PROVISIONAL。印が無い・想定外の値は UNKNOWN（確定とは判断しない）', () => {
    expect(kpiBasisOf({ targetBasis: 'AI_PROVISIONAL' })).toBe('AI_PROVISIONAL');
    expect(kpiBasisOf({})).toBe('UNKNOWN');
    expect(kpiBasisOf({ targetBasis: 'STAGE_DATA' })).toBe('UNKNOWN');
    expect(kpiBasisOf({ targetBasis: null })).toBe('UNKNOWN');
  });

  it('AI仮提案だけを分け、それ以外はAIが変えられない側に残す', () => {
    const items = [
      { basis: 'USER_CONFIRMED' as const, n: 1 },
      { basis: 'UNKNOWN' as const, n: 2 },
      { basis: 'AI_PROVISIONAL' as const, n: 3 },
    ];
    const { locked, aiProvisional } = splitKpisByBasis(items);
    expect(locked.map((x) => x.n)).toEqual([1, 2]);
    expect(aiProvisional.map((x) => x.n)).toEqual([3]);
  });
});

describe('生成エンジンに渡す時点でのKPIの分離', () => {
  it('AI仮提案は確定KPIとして渡さず、別の提案として渡す', () => {
    const ctx = ctxOf(withKpis([confirmed, aiProvisional]));
    expect(ctx.stage3Kpis.map((k) => k.label)).toEqual(['改装提案を出した商業施設数']);
    expect(ctx.aiProvisionalKpis.map((k) => k.label)).toEqual(['動線分析の実施件数']);
    expect(ctx.sources.some((s) => s.ref === 'S3-KPI-k-ai')).toBe(false);
    expect(ctx.sources.some((s) => s.ref === 'AI-KPI-k-ai')).toBe(true);
  });

  it('AI仮提案は、確定KPIの保護一覧（S1, S2…）に入らない', () => {
    const ctx = ctxOf(withKpis([confirmed, aiProvisional]));
    const protectedLabels = protectedKpisOf(ctx).map((k) => k.label);
    expect(protectedLabels).not.toContain('動線分析の実施件数');
  });

  it('利用者が確定した目標は、確定として保護する（目標・期限・担当を変えない）', () => {
    const ctx = ctxOf(withKpis([confirmed]));
    const [k] = protectedKpisOf(ctx);
    expect(k).toMatchObject({ label: '改装提案を出した商業施設数', target: 3, unit: '件', due: '2027-02', owner: '田村 誠（仮）', confirmation: 'USER_CONFIRMED' });
    expect(ctx.sources.find((s) => s.ref === 'S3-KPI-k-confirmed')?.label).toBe('確定済みKPI（変更不可）');
  });

  it('印の無いKPIは、AIには変えさせないが、確定とは表示しない', () => {
    const ctx = ctxOf(withKpis([unknown]));
    const [k] = protectedKpisOf(ctx);
    expect(k.confirmation).toBe('UNCONFIRMED');
    expect(k.target).toBe(30);
    expect(ctx.sources.find((s) => s.ref === 'S3-KPI-k-unknown')?.label).toBe('入力済みKPI（変更不可・確定の印なし）');
    expect(k.measurement).not.toContain('確定済みKPI');
  });

  it('目標値0を未設定と誤判定しない（保護一覧にも文脈にも0が残る）', () => {
    const ctx = ctxOf(withKpis([zeroTarget]));
    const [k] = protectedKpisOf(ctx);
    expect(k.target).toBe(0);
    expect(k.targetBasis).toBe('STAGE_DATA');
    expect(ctx.sources.find((s) => s.ref === 'S3-KPI-k-zero')?.text).toContain('目標 0件');
  });

  it('プロンプトでは、確定の保護一覧にだけS番号を振り、AI仮提案は別の文脈として書く', () => {
    const ctx = ctxOf(withKpis([confirmed, unknown, aiProvisional]));
    const prompt = buildExecutionPlanPrompt(ctx);
    expect(prompt).toContain('stage3KpiId: k-confirmed');
    expect(prompt).toContain('stage3KpiId: k-unknown');
    expect(prompt).not.toContain('stage3KpiId: k-ai');
    expect(prompt).toContain('AIが仮に置いた目標（確定ではない・書き直し可）');
  });

  it('入力データを変更しない（渡したKPIの値は読み取りだけ）', () => {
    const raw = withKpis([confirmed, unknown, aiProvisional, zeroTarget]);
    const before = JSON.stringify(raw);
    ctxOf(raw);
    protectedKpisOf(ctxOf(raw));
    expect(JSON.stringify(raw)).toBe(before);
  });
});
