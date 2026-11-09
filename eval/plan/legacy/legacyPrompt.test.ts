import { readFileSync } from 'fs';
import path from 'path';
import { buildLegacyDraftPrompt, type LegacyRequestBody } from './legacyPrompt';

const routeSource = readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'app', 'api', 'stage4', 'generate-execution-draft', 'route.ts'),
  'utf8'
);
const copySource = readFileSync(path.resolve(__dirname, 'legacyPrompt.ts'), 'utf8');

/** ソース内の文を、開始マーカーから終了マーカーまで切り出す（終了マーカーを含む） */
function segment(src: string, start: string, end: string): string {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`開始位置が無い: ${start}`);
  const e = src.indexOf(end, s);
  if (e < 0) throw new Error(`終了位置が無い: ${end}`);
  return src.slice(s, e + end.length);
}

const SEGMENTS: Array<[string, string, string, string]> = [
  ['期限の計算', 'const getMonthAfter', '};\n', '\n'],
  ['STAGE3 KPIの節', 'const sourceKpisText = ', "';", ''],
  ['プロジェクト情報', 'const projectContext = `', '`.trim();', ''],
  ['本文プロンプト', 'const prompt = `', '`;', ''],
];

describe('既存STAGE4プロンプトの複製（本番との文字単位の一致）', () => {
  it.each(SEGMENTS)('%s が本番の route.ts と完全に一致する', (_name, start, end) => {
    const fromRoute = segment(routeSource, start, end);
    const fromCopy = segment(copySource, start, end);
    expect(fromCopy).toBe(fromRoute);
  });

  it('本番と同じ現在日（2026-11-09）で、期限の窓が正しく出る', () => {
    const body: LegacyRequestBody = {
      departmentName: '営業部',
      projectTitle: '試験',
      hypothesis: '',
      rationale: '',
      reason: '',
      kind: '',
      mainLever: '',
      horizon: '',
      role: 'REVENUE',
      due: '',
      ownerName: '',
      sourceKpis: ['KPI①'],
      companyStrategy: '',
      companyTargets: [],
      companyContext: { priorityThemes: [] },
    };
    const p = buildLegacyDraftPrompt(body, { year: 2026, month: 11, day: 9 });
    expect(p).toContain('期限は 2027-02 ～ 2027-05 の範囲');
    expect(p).toContain('期限は 2026-12 ～ 2027-02 の範囲');
    expect(p).toContain('1. KPI①');
  });
});
