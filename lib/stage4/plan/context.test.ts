import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { DEEPEN_INPUT } from '@/eval/plan/fixtures/deepen';
import { HIRE_INPUT } from '@/eval/plan/fixtures/hire';
import { addMonths, bigrams, buildPlanContext, relevance } from './context';
import { buildPlanSource, type RawPlanInput } from './source';

const ctxOf = (raw: RawPlanInput) => {
  const { source, scope } = buildPlanSource(raw);
  return buildPlanContext(source, scope);
};

describe('計画期間', () => {
  it('現在月の翌月から6か月間を計画期間にする', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-11', 6)).toBe('2027-05');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });

  it('商業施設の計画期間は 2026-12〜2027-05', () => {
    const c = ctxOf(COMMERCIAL_INPUT);
    expect(c.startYm).toBe('2026-12');
    expect(c.endYm).toBe('2027-05');
  });
});

describe('関連性の判定', () => {
  it('同じ話題の文は、無関係な文より高く評価される', () => {
    const corpus = bigrams('テナントの売上低下と改装の判断');
    expect(relevance('テナント売上の変化が見えない', corpus)).toBeGreaterThan(relevance('保守契約の継続率', corpus));
  });
});

describe('buildPlanContext（情報の構造化）', () => {
  it('STAGE2の最終ストーリーとSTAGE3のKPIを、根拠として必ず含める', () => {
    const c = ctxOf(COMMERCIAL_INPUT);
    const refs = c.sources.map((s) => s.ref);
    expect(refs).toEqual(expect.arrayContaining(['S2-STORY-1', 'S2-STORY-2', 'S2-STORY-3', 'S2-CORE', 'S1-FIN', 'S3-DEPT']));
    expect(refs).toEqual(expect.arrayContaining(['S3-KPI-fx-kpi-proposals', 'S3-KPI-fx-kpi-days']));
  });

  it('参照IDは一意である', () => {
    const c = ctxOf(COMMERCIAL_INPUT);
    const refs = c.sources.map((s) => s.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('無関係な他部門の施策は根拠に入れない', () => {
    const c = ctxOf(COMMERCIAL_INPUT);
    expect(c.sources.some((s) => s.text.includes('保守契約の継続率'))).toBe(false);
  });

  it('入力の総量は上限内に収まる（すべてを無条件に投入しない）', () => {
    for (const raw of [COMMERCIAL_INPUT, DEEPEN_INPUT, HIRE_INPUT]) {
      const total = ctxOf(raw).sources.reduce((n, s) => n + s.text.length, 0);
      expect(total).toBeLessThan(4000);
    }
  });

  it('担当者の候補は入力にある人名だけ（推測の人名を含まない）', () => {
    expect(ctxOf(COMMERCIAL_INPUT).ownerCandidates).toEqual(['田村 誠（仮）']);
    expect(ctxOf(HIRE_INPUT).ownerCandidates).toEqual([]);
  });

  it('確定済みKPIは、構造化された入力の値をそのまま保持する', () => {
    const c = ctxOf(DEEPEN_INPUT);
    expect(c.stage3Kpis.map((k) => k.label)).toEqual(['追加配送を始めた法人顧客数', '配送提案の実施件数']);
    expect(c.stage3Kpis[0]).toMatchObject({ target: 10, unit: '件', due: '2027-04' });
  });

  it('重要な戦略結論は、文字の重なりがゼロでも根拠に入る', () => {
    const { source: s0, scope: sc } = buildPlanSource(COMMERCIAL_INPUT);
    const s1 = { ...s0, stage2: { ...s0.stage2, priorityThemes: ['海外の販路を開く'] } };
    const c = buildPlanContext(s1, sc);
    expect(c.sources.find((x) => x.ref === 'S2-PRIO-1')?.text).toBe('海外の販路を開く');
  });

  it('計画期間の根拠と、部門の勝ち筋・重点課題が必ず入る', () => {
    const c = ctxOf(COMMERCIAL_INPUT);
    expect(c.sources.find((x) => x.ref === 'S3-PERIOD')?.text).toContain('2026-12 〜 2027-05');
    const dept = c.sources.find((x) => x.ref === 'S3-DEPT');
    expect(dept?.text).toContain('勝ち筋：existing-customer');
    expect(c.sources.filter((x) => x.ref.startsWith('S3-ISSUE-')).length).toBeGreaterThan(0);
  });
});
