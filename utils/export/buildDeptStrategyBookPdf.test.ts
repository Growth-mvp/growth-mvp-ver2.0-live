import { buildDeptStrategyBookPdfData, formatConfirmedDate } from './buildDeptStrategyBookPdf';

const state = {
  companyName: '日本製罐株式会社',
  departments: [
    {
      id: 'd-can',
      name: '金属缶製造販売事業',
      mission: '国内の缶需要に応える',
      missionDescription: '安定供給を支える',
      currentPosition: '成熟した主力事業',
      strategicRole: '収益の柱を守る',
      keyIssues: ['原価上昇', '受注の平準化'],
      intraDeptCollab: ['製造と販売の日程共有'],
      interDeptCollab: ['開発部と新用途を試作する'],
      alignmentRiskPoints: ['価格の認識がずれやすい'],
      projects: [
        {
          id: 'proj-stable-1',
          title: '缶の原価低減',
          reason: '原価が上がっている',
          hypothesis: '工程改善で原価率が下がる',
          okrs: [{ objective: '原価率を下げる', keyResults: ['原価率 2pt 低減', '不良率 0.5%以下'] }],
          kpis: ['原価率'],
        },
        { id: 'proj-2', title: '新用途の開拓', reason: '', hypothesis: '', okrs: [] },
      ],
    },
    {
      id: 'd-other',
      name: '別事業',
      mission: '別事業の使命（混ざってはいけない）',
      projects: [{ id: 'proj-x', title: '別事業の計画' }],
    },
  ],
};

describe('buildDeptStrategyBookPdfData（確定済みの正式データから、戦略書のPDF用の内容を作る）', () => {
  it('対象の事業・部門の確定内容を、章ごとに取り出す', () => {
    const data = buildDeptStrategyBookPdfData(state, '金属缶製造販売事業', '2026-11-12T03:00:00.000Z');
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.companyName).toBe('日本製罐株式会社');
    expect(data.mission).toEqual(['国内の缶需要に応える']);
    expect(data.missionDescription).toEqual(['安定供給を支える']);
    expect(data.currentPosition).toEqual(['成熟した主力事業']);
    expect(data.strategicRole).toEqual(['収益の柱を守る']);
    expect(data.keyIssues).toEqual(['原価上昇', '受注の平準化']);
    expect(data.intraCollab).toEqual(['製造と販売の日程共有']);
    expect(data.interCollab).toEqual(['開発部と新用途を試作する']);
  });

  it('プロジェクトは目的・選定理由・成果仮説・KPI・目標を出し、同じ指標は重複させない', () => {
    const data = buildDeptStrategyBookPdfData(state, '金属缶製造販売事業', undefined);
    const p = data?.projects[0];
    expect(p?.title).toBe('缶の原価低減');
    expect(p?.purpose).toEqual(['原価率を下げる', '原価が上がっている']);
    expect(p?.hypothesis).toEqual(['工程改善で原価率が下がる']);
    expect(p?.goals).toEqual(['原価率 2pt 低減', '不良率 0.5%以下', '原価率']);
  });

  it('他の事業・部門のデータ、内部ID、内容の無い項目は出さない', () => {
    const data = buildDeptStrategyBookPdfData(state, '金属缶製造販売事業', undefined);
    const text = JSON.stringify(data);
    expect(text).not.toContain('別事業');
    expect(text).not.toContain('proj-');
    expect(text).not.toContain('d-can');
    expect(text).not.toContain('価格の認識がずれやすい');
    expect(data?.projects).toHaveLength(2);
    expect(data?.projects[1]).toEqual({ title: '新用途の開拓', purpose: [], hypothesis: [], goals: [] });
  });

  it('対象の部門が無ければ null を返す（別の部門の内容は出さない）', () => {
    expect(buildDeptStrategyBookPdfData(state, '存在しない部門', undefined)).toBeNull();
  });

  it('会社名が無ければ、会社名未入力と表示する', () => {
    const data = buildDeptStrategyBookPdfData({ ...state, companyName: '' }, '金属缶製造販売事業', undefined);
    expect(data?.companyName).toBe('（会社名未入力）');
  });

  it('確定日は、日本の年月日の形式で表す。不正な日付は空にする', () => {
    expect(formatConfirmedDate(undefined)).toBe('');
    expect(formatConfirmedDate('not-a-date')).toBe('');
    expect(formatConfirmedDate('2026-11-12T03:00:00.000Z')).toBe('2026年11月12日');
  });
});
