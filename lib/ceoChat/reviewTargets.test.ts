import {
  buildReviewPromptBlock,
  buildStage4ReviewCandidates,
  classifyReviewRun,
  extractReviewMarkers,
  parseReviewTargets,
} from './reviewTargets';

const STRATEGY = 'strategy-1';

const DEPTS = [
  {
    id: 'dept-sales',
    name: '営業部',
    projects: [
      {
        id: 'proj-new',
        title: '新規開拓',
        reason: '受注件数を増やす',
        okrsV2: [
          { id: 'kr-1', label: '有償開発受注件数', target: 12, unit: '件', actual: { value: 999 } },
          { id: 'kr-2', label: '量産後の案件別粗利額', target: null, unit: null },
        ],
      },
      { title: 'ID無しの案件', okrsV2: [{ id: 'kr-x', label: 'ID無しKPI', target: 1, unit: '件' }] },
    ],
  },
  {
    id: 'dept-prod',
    name: '製造部',
    projects: [
      { id: 'proj-new', title: '新規開拓', okrsV2: [{ id: 'kr-3', label: '歩留まり', target: 95, unit: '%' }] },
      { id: 'proj-line', title: '量産ライン改善', okrsV2: [] , kpis: ['稼働率'] },
    ],
  },
];

describe('見直し候補の作成（登録済みの実在データのみ）', () => {
  it('プロジェクトIDのある案件だけを候補にし、IDの無い案件は案内しない', () => {
    const { candidates, unlinkableProjects } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
    expect(candidates.map((c) => c.projectTitle)).not.toContain('ID無しの案件');
    expect(unlinkableProjects).toBeGreaterThanOrEqual(1);
  });

  it('同名の案件は、部門IDを含むリンクで区別する', () => {
    const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
    const sameName = candidates.filter((c) => c.projectTitle === '新規開拓');
    expect(sameName).toHaveLength(2);
    expect(new Set(sameName.map((c) => c.href)).size).toBe(2);
    expect(sameName.map((c) => c.href)).toEqual([
      '/okr?projectId=proj-new&deptId=dept-sales',
      '/okr?projectId=proj-new&deptId=dept-prod',
    ]);
  });

  it('プロジェクトIDが部門をまたいで重複し、部門IDも無い場合は、どれか特定できないので案内しない', () => {
    const depts = [
      { name: '部門A', projects: [{ id: 'dup', title: 'A案件' }] },
      { name: '部門B', projects: [{ id: 'dup', title: 'B案件' }] },
    ];
    const { candidates, unlinkableProjects } = buildStage4ReviewCandidates(depts, STRATEGY);
    expect(candidates).toEqual([]);
    expect(unlinkableProjects).toBe(2);
  });

  it('リンクはプロジェクトIDを使い、KRのIDを案件のリンクに使わない', () => {
    const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
    for (const c of candidates) {
      expect(c.href).toMatch(/^\/okr\?projectId=/);
      for (const k of c.kpis) expect(c.href).not.toContain(k.krId ?? '#none');
    }
  });

  it('KPIは登録された目標値・単位を持ち、実績値（actual）は扱わない', () => {
    const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
    const sales = candidates.find((c) => c.departmentId === 'dept-sales' && c.projectTitle === '新規開拓');
    expect(sales?.kpis).toEqual([
      { krId: 'kr-1', label: '有償開発受注件数', target: 12, unit: '件' },
      { krId: 'kr-2', label: '量産後の案件別粗利額', target: null, unit: null },
    ]);
    expect(JSON.stringify(candidates)).not.toContain('999');
  });

  it('旧形式のKPIは、既存KPIとして区別して扱う（KR IDは付けない）', () => {
    const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
    const line = candidates.find((c) => c.projectTitle === '量産ライン改善');
    expect(line?.kpis).toEqual([]);
    expect(line?.legacyKpiLabels).toEqual(['稼働率']);
  });

  it('部門・案件が無い場合は候補なし', () => {
    expect(buildStage4ReviewCandidates(undefined, STRATEGY).candidates).toEqual([]);
    expect(buildStage4ReviewCandidates([], STRATEGY).candidates).toEqual([]);
  });
});

describe('AIへ渡す候補一覧', () => {
  it('候補がなければ、ブロックを作らない', () => {
    expect(buildReviewPromptBlock({ candidates: [], unlinkableProjects: 0 }, '売上').text).toBe('');
  });

  it('質問に関連度の高い候補を先に並べる（同名の案件は、粗利のKPIを持つ営業部の方が先）', () => {
    const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
    const reversed = { candidates: [...candidates].reverse(), unlinkableProjects: 0 };
    const { text, shown } = buildReviewPromptBlock(reversed, '量産後の案件別粗利額を確認したい');
    expect(shown[0].departmentName).toBe('営業部');
    const firstLine = text.split('\n').find((l) => l.startsWith('- r')) ?? '';
    expect(firstLine).toContain('部門: 営業部');
  });

  it('件数を切った場合は、切ったことと「未登録と断定しない」指示を明示する', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i + 1}`,
      strategyId: STRATEGY,
      projectId: `p${i}`,
      departmentId: null,
      departmentName: '部門',
      projectTitle: `案件${i}`,
      summary: '',
      kpis: [],
      legacyKpiLabels: [],
      href: `/okr?projectId=p${i}`,
    }));
    const { text, shown } = buildReviewPromptBlock({ candidates: many, unlinkableProjects: 0 }, '案件');
    expect(shown.length).toBeLessThan(20);
    expect(text).toContain('全20件のうち');
    expect(text).toContain('『存在しない』『未登録』と断定しない');
  });

  it('プロンプトには、サーバーが作った候補IDと登録済みの名称・目標だけを書く（URLは書かない）', () => {
    const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
    const { text } = buildReviewPromptBlock({ candidates, unlinkableProjects: 0 }, '受注');
    expect(text).toContain('有償開発受注件数（目標 12件）');
    expect(text).not.toContain('/okr?projectId=');
    expect(text).not.toContain('kr-1');
  });
});

describe('AIの回答から案内先を決める（照合）', () => {
  const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
  const shown = new Map(candidates.map((c) => [c.id, c]));

  it('提示済みの候補IDだけを案内先にし、案内の行を本文から取り除く', () => {
    const raw = '粗利の確認が必要です。\n\n[見直し候補: r1]';
    const r = extractReviewMarkers(raw, shown);
    expect(r.content).toBe('粗利の確認が必要です。');
    expect(r.reviewTargets).toEqual([
      expect.objectContaining({
        stage: 4,
        candidateId: 'r1',
        strategyId: STRATEGY,
        href: '/okr?projectId=proj-new&deptId=dept-sales',
        label: '新規開拓のKPIを確認',
        checkItems: ['KPI・目標値'],
      }),
    ]);
  });

  it('存在しないIDは案内しない（架空のリンクを作らない）', () => {
    const r = extractReviewMarkers('本文\n[見直し候補: r99]', shown);
    expect(r.reviewTargets).toEqual([]);
    expect(r.content).toBe('本文');
  });

  it('本文中のURLや、AIが書いたプロジェクトIDは案内先にしない', () => {
    const raw = '詳しくは /okr?projectId=proj-new を見てください。';
    const r = extractReviewMarkers(raw, shown);
    expect(r.reviewTargets).toEqual([]);
    expect(r.content).toBe(raw);
  });

  it('同じIDは1件にまとめ、件数は3件までにする', () => {
    const r = extractReviewMarkers('[見直し候補: r1, r1, r2, r3, r4]', shown);
    expect(r.reviewTargets.map((t) => t.candidateId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('マーカーが無い回答は、本文も案内も変えない', () => {
    const raw = '一般的な助言です。';
    const r = extractReviewMarkers(raw, shown);
    expect(r.content).toBe(raw);
    expect(r.reviewTargets).toEqual([]);
  });
});

describe('診断情報（件数と理由コードのみ）', () => {
  const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
  const shown = new Map(candidates.map((c) => [c.id, c]));

  it('マーカーの行数・有効な形式・ID一致を数える', () => {
    const r = extractReviewMarkers('本文\n[見直し候補: r1, r99]\n[見直し候補: r2]', shown);
    expect(r.diagnostics).toEqual({
      markerLines: 2,
      validMarkerLines: 2,
      markerIds: 3,
      matchedIds: 2,
      unmatchedIds: 1,
      returned: 2,
    });
  });

  it('全角の括弧など、形式が合わないマーカーは、行として数えるが有効には数えない', () => {
    const r = extractReviewMarkers('本文\n【見直し候補: r1】', shown);
    expect(r.diagnostics.markerLines).toBe(1);
    expect(r.diagnostics.validMarkerLines).toBe(0);
    expect(r.diagnostics.returned).toBe(0);
  });

  it.each([
    [
      'A: 候補が0件',
      { asJson: false, stage4Total: 0, unlinkable: 0, shownInPrompt: 0, relevantOutsideShown: 0, marker: null },
      'no_candidates',
    ],
    [
      'A: 候補が0件（ID不足で全て除外）',
      { asJson: false, stage4Total: 0, unlinkable: 2, shownInPrompt: 0, relevantOutsideShown: 0, marker: null },
      'no_linkable_candidates',
    ],
    [
      'C: マーカーなし',
      {
        asJson: false,
        stage4Total: 2,
        unlinkable: 0,
        shownInPrompt: 2,
        relevantOutsideShown: 0,
        marker: { markerLines: 0, validMarkerLines: 0, markerIds: 0, matchedIds: 0, unmatchedIds: 0, returned: 0 },
      },
      'no_marker',
    ],
    [
      'D: 形式が合わない',
      {
        asJson: false,
        stage4Total: 2,
        unlinkable: 0,
        shownInPrompt: 2,
        relevantOutsideShown: 0,
        marker: { markerLines: 1, validMarkerLines: 0, markerIds: 0, matchedIds: 0, unmatchedIds: 0, returned: 0 },
      },
      'marker_format_invalid',
    ],
    [
      'E: IDが提示済み候補と不一致',
      {
        asJson: false,
        stage4Total: 2,
        unlinkable: 0,
        shownInPrompt: 2,
        relevantOutsideShown: 0,
        marker: { markerLines: 1, validMarkerLines: 1, markerIds: 1, matchedIds: 0, unmatchedIds: 1, returned: 0 },
      },
      'marker_id_mismatch',
    ],
    [
      '返却あり',
      {
        asJson: false,
        stage4Total: 2,
        unlinkable: 0,
        shownInPrompt: 2,
        relevantOutsideShown: 0,
        marker: { markerLines: 1, validMarkerLines: 1, markerIds: 1, matchedIds: 1, unmatchedIds: 0, returned: 1 },
      },
      'returned',
    ],
    [
      'JSON出力では抽出を行わない',
      { asJson: true, stage4Total: 2, unlinkable: 0, shownInPrompt: 2, relevantOutsideShown: 0, marker: null },
      'json_output',
    ],
  ])('理由コード（%s）', (_label, input, reason) => {
    expect(classifyReviewRun(input as any).reason).toBe(reason);
  });

  it('関連する候補が提示範囲外にあった件数を別に示す（B の判定材料）', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i + 1}`,
      strategyId: STRATEGY,
      projectId: `p${i}`,
      departmentId: null,
      departmentName: '部門',
      projectTitle: i === 3 ? '粗利改善A' : i === 4 ? '粗利改善' : `案件${i}`,
      summary: '',
      kpis: [],
      legacyKpiLabels: [],
      href: `/okr?projectId=p${i}`,
    }));
    const r = buildReviewPromptBlock({ candidates: many, unlinkableProjects: 0 }, '粗利改善の進め方', { maxItems: 1 });
    expect(r.shown).toHaveLength(1);
    expect(r.relevantOutsideShown).toBe(1);
  });

  it('診断の出力に、案件名・KPI名・回答本文を含めない', () => {
    const r = extractReviewMarkers('粗利の確認が必要です。\n[見直し候補: r1]', shown);
    const report = classifyReviewRun({
      asJson: false,
      stage4Total: candidates.length,
      unlinkable: 0,
      shownInPrompt: candidates.length,
      relevantOutsideShown: 0,
      marker: r.diagnostics,
      finishReason: 'stop',
      contentChars: 20,
    });
    const text = JSON.stringify(report);
    expect(text).not.toContain('新規開拓');
    expect(text).not.toContain('有償開発受注件数');
    expect(text).not.toContain('粗利の確認');
    expect(report.reason).toBe('returned');
  });
});

describe('マーカーを出す条件（指示文）', () => {
  const { candidates } = buildStage4ReviewCandidates(DEPTS, STRATEGY);
  const { text } = buildReviewPromptBlock({ candidates, unlinkableProjects: 0 }, 'KPIの改善');

  it('既存プロジェクトのKPIや実行計画の見直しを具体的に勧める場合に、関連する候補を1件選ぶよう指示する', () => {
    expect(text).toContain('既存プロジェクトのKPIや実行計画の見直しを具体的に勧める場合は、下の一覧から最も関連する候補を1件選び');
    expect(text).toContain('「[見直し候補: r1]」の形式');
  });

  it('関連候補がない・関連が不明確・数値確認だけの場合は、マーカーを出力しないよう指示する', () => {
    expect(text).toContain('次の場合はマーカーを出力しないでください');
    expect(text).toContain('関連する候補が一覧にない場合');
    expect(text).toContain('関連が不明確な場合');
    expect(text).toContain('数値の確認や一般的な質問だけの場合');
  });

  it('提示されていないIDを作らないよう指示する', () => {
    expect(text).toContain('提示されていないIDを作らず');
  });
});

describe('途中切れと出力なしの区別（診断）', () => {
  const base = {
    asJson: false,
    stage4Total: 2,
    unlinkable: 0,
    shownInPrompt: 2,
    relevantOutsideShown: 0,
    marker: { markerLines: 0, validMarkerLines: 0, markerIds: 0, matchedIds: 0, unmatchedIds: 0, returned: 0 },
    contentChars: 120,
  };

  it('マーカーが無く、終了理由が length なら no_marker_truncated と途中切れの疑いを記録する', () => {
    const r = classifyReviewRun({ ...base, finishReason: 'length' });
    expect(r).toMatchObject({ reason: 'no_marker_truncated', finishReason: 'length', possiblyTruncated: true, contentChars: 120 });
  });

  it('マーカーが無く、終了理由が stop なら no_marker（AIが出力しなかった）', () => {
    const r = classifyReviewRun({ ...base, finishReason: 'stop' });
    expect(r).toMatchObject({ reason: 'no_marker', finishReason: 'stop', possiblyTruncated: false });
  });

  it('終了理由が無い場合は途中切れと断定しない', () => {
    const r = classifyReviewRun({ ...base, finishReason: null });
    expect(r).toMatchObject({ reason: 'no_marker', finishReason: null, possiblyTruncated: false });
  });

  it('マーカーがあれば、終了理由が length でも returned や形式の判定を優先する', () => {
    const r = classifyReviewRun({
      ...base,
      finishReason: 'length',
      marker: { markerLines: 1, validMarkerLines: 1, markerIds: 1, matchedIds: 1, unmatchedIds: 0, returned: 1 },
    });
    expect(r.reason).toBe('returned');
    expect(r.possiblyTruncated).toBe(true);
  });
});

describe('画面に渡す前の検証', () => {
  const good = {
    stage: 4,
    candidateId: 'r1',
    strategyId: STRATEGY,
    label: '案件のKPIを確認',
    href: '/okr?projectId=proj-new&deptId=dept-sales',
    projectTitle: '新規開拓',
    departmentName: '営業部',
    checkItems: ['KPI・目標値'],
  };

  it('サーバーが作った形式だけを通す', () => {
    expect(parseReviewTargets([good])).toHaveLength(1);
  });

  it.each([
    ['別の画面への href', { ...good, href: '/stage1' }],
    ['外部URL', { ...good, href: 'https://example.com/okr?projectId=x' }],
    ['STAGE番号が違う', { ...good, stage: 2 }],
    ['戦略IDが無い', { ...good, strategyId: '' }],
  ])('%s は捨てる', (_label, value) => {
    expect(parseReviewTargets([value])).toEqual([]);
  });

  it('配列でない値は空配列', () => {
    expect(parseReviewTargets(undefined)).toEqual([]);
    expect(parseReviewTargets('x')).toEqual([]);
  });
});
