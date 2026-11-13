import {
  generateSlotProjects,
  normalizeMainLever,
  normalizeCascadeReview,
  reviewSlotCandidate,
  validateCascadeReview,
  MAIN_LEVER_CORRECTION,
} from './cascadeReview';

const EVIDENCE = '既存顧客の再発注は、書類作成の手間で止まっている。手続きを半分にできる点が選ばれる理由になる。';
const PARTNERS = ['開発部'];

function keyResult(kind: string, label: string) {
  return {
    label,
    unit: '件',
    kind,
    measurementScope: kind === 'leading' ? 'internal_process' : kind === 'business_outcome' ? 'own_business' : 'client_business',
    population: '対象顧客',
    calculation: '件数の合計',
    dataSource: '受注記録',
    comparison: '前年同期',
    measurementMethod: '件数を月次で集計する',
    hypothesisLink: 'この施策の成否を測る',
  };
}

/** 検証を通る1スロット分の案（mainLever 以外は正しい） */
function validProject(slot: number, overrides: Record<string, unknown> = {}) {
  const lane = slot <= 2 ? 'existing' : slot === 3 ? 'new' : slot === 4 ? 'intraCollab' : 'interCollab';
  return {
    slot,
    title: `施策${slot}`,
    reason: '再発注の手間を減らす',
    hypothesis: 'もし書類作成を一度で済ませれば、再発注が増える',
    objective: '再発注を増やす',
    strategyBasis: EVIDENCE.split('。')[0] + '。',
    strategyBasisIds: [],
    mainLever: 'ARPU',
    horizon: 'mid',
    kind: 'growth',
    collaboration: lane === 'existing' || lane === 'new' ? '' : '連携先と分担を決める',
    partnerDepartment: slot === 5 ? '開発部' : '',
    skillRequirements: { roleSkills: ['営業'], executionSkills: ['集計'] },
    humanInvestments: [
      { category: 'TRAINING_OJT', title: '研修', detail: '手順を教える' },
      { category: 'TOOLS_PROCESS', title: '仕組み', detail: '書類を標準化する' },
    ],
    causalDesign: {
      buyer: '既存顧客', problem: '書類作成に時間がかかる', intervention: '書類を一度で作る',
      customerChange: '手続きが減る', revenueMechanism: '再発注が増える', differentiation: '手続きの短さ',
    },
    keyResults: [
      keyResult(slot === 3 ? 'validation' : 'business_outcome', `再発注件数${slot}`),
      keyResult(slot === 3 ? 'validation' : 'customer_outcome', `手続き時間${slot}`),
      keyResult('leading', `提案件数${slot}`),
    ],
    exploration: slot === 3 ? { payer: '顧客', offering: '書類支援', paymentTest: '試験', decisionRule: '継続率' } : undefined,
    collaborationStructure: slot === 4 ? {
      phases: [
        { phase: '準備', owner: '営業', deliverable: '対象の整理', handoverTo: '開発' },
        { phase: '実行', owner: '開発', deliverable: '試作', handoverTo: '営業' },
      ],
      jointDecision: '月次で判断する',
    } : undefined,
    crossBusinessStructure: slot === 5 ? {
      partnerBusiness: '開発部', ownResponsibility: '販売', partnerResponsibility: '設計',
      revenueAttribution: '自部門の売上', responsibilityBoundary: '設計の品質は開発部', unclarifiedItems: [],
    } : undefined,
    ...overrides,
  };
}

function reviewWith(projects: unknown[]) {
  return {
    missionDraft: '既存顧客の深耕', missionDescription: '説明', currentPosition: '位置づけ', strategicRole: '役割',
    projects,
  };
}

const ALL_SLOTS = [1, 2, 3, 4, 5];
const CTX = { plan: reviewWith([]), allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '営業部' };

describe('mainLever の正規化（定義どおりの表記ゆれだけを同じ値として扱う）', () => {
  it('正しいコードはそのまま通す', () => {
    expect(normalizeMainLever('ACQ')).toBe('ACQ');
    expect(normalizeMainLever('FUTURE')).toBe('FUTURE');
  });

  it('大文字小文字・前後の空白・全角半角の違いは、同じコードへ正規化する', () => {
    expect(normalizeMainLever('arpu')).toBe('ARPU');
    expect(normalizeMainLever('  Churn  ')).toBe('CHURN');
    expect(normalizeMainLever('ＣＯＳＴ')).toBe('COST');
  });

  it('先頭にコードが明示された表記（例：ARPU（客単価））は、そのコードへ正規化する', () => {
    expect(normalizeMainLever('ARPU（客単価）')).toBe('ARPU');
    expect(normalizeMainLever('ACQ: 新規顧客数')).toBe('ACQ');
  });

  it('プロンプトに示した定義文そのものは、そのレバーとして扱う', () => {
    expect(normalizeMainLever('単価・LTV・客単価')).toBe('ARPU');
    expect(normalizeMainLever('解約率・離脱率')).toBe('CHURN');
  });

  it('意味を推測しなければ決められない値は、元のまま返し、別のレバーへ振り分けない', () => {
    expect(normalizeMainLever('入会転換と退会抑制')).toBe('入会転換と退会抑制');
    expect(normalizeMainLever('ACQとCHURN')).toBe('ACQとCHURN');
    expect(normalizeMainLever(['ACQ'])).toEqual(['ACQ']);
  });
});

describe('プロジェクト全体の検証（mainLever）', () => {
  it('1. 正常な mainLever は品質検証を通過する', () => {
    const errors = validateCascadeReview(reviewWith([validProject(1), validProject(2)]), PARTNERS, EVIDENCE, '営業部');
    expect(errors.filter((e) => e.endsWith('_lever'))).toEqual([]);
  });

  it('不正な mainLever は、そのスロットの lever 指摘になる', () => {
    const errors = validateCascadeReview(reviewWith([validProject(1, { mainLever: '入会転換と退会抑制' })]), PARTNERS, EVIDENCE, '営業部');
    expect(errors).toContain('slot_1_lever');
  });

  it('2. 表記ゆれは正規化されてから検証され、指摘にならない', () => {
    const normalized = normalizeCascadeReview(reviewWith([validProject(1, { mainLever: ' arpu ' })]), EVIDENCE);
    expect(normalized.projects[0].mainLever).toBe('ARPU');
    const errors = validateCascadeReview(normalized, PARTNERS, EVIDENCE, '営業部');
    expect(errors.filter((e) => e.endsWith('_lever'))).toEqual([]);
  });
});

describe('スロットの修復（不正な mainLever は該当スロットだけ作り直す）', () => {
  it('3. 不正な mainLever は該当スロットの修復に進み、修正指示が付く。正常なスロットは作り直さない', async () => {
    const calls: Record<number, Array<{ prev: unknown; errors: string[]; correction?: string }>> = {};
    const requestSlot = async (template: { slot: number }, feedback: { previousValidationErrors: string[]; mainLeverCorrection?: string; previousCandidate: unknown }) => {
      const slot = template.slot;
      (calls[slot] ??= []).push({ prev: feedback.previousCandidate, errors: feedback.previousValidationErrors, correction: feedback.mainLeverCorrection });
      // 5番目だけ、1回目は説明文を返し、2回目で正しいコードを返す
      if (slot === 5 && calls[5].length === 1) return { project: validProject(5, { mainLever: '入会転換と退会抑制' }) };
      return { project: validProject(slot) };
    };
    const projects = await generateSlotProjects({
      templates: ALL_SLOTS.map((slot) => ({ slot })), requestSlot, plan: reviewWith([]),
      allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '営業部',
    });
    expect(projects).toHaveLength(5);
    expect(projects[4].mainLever).toBe('ARPU');
    expect(calls[5]).toHaveLength(2);
    expect(calls[5][1].errors).toEqual(['slot_5_lever']);
    expect(calls[5][1].correction).toContain(MAIN_LEVER_CORRECTION);
    expect(calls[5][1].correction).toContain('入会転換と退会抑制');
    for (const slot of [1, 2, 3, 4]) expect(calls[slot]).toHaveLength(1);
  });

  it('修復しても解消しなければ、指摘を連結した例外になる（品質基準は緩めない）', async () => {
    const requestSlot = async (template: { slot: number }) =>
      template.slot === 2 ? { project: validProject(2, { mainLever: 'わからない' }) } : { project: validProject(template.slot) };
    await expect(
      generateSlotProjects({
        templates: [{ slot: 1 }, { slot: 2 }], requestSlot, plan: reviewWith([]),
        allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '営業部',
      }),
    ).rejects.toThrow('slot_2_lever');
  });

  it('5. 修復後も、既存の KPI・プロジェクトID・連携先・部門の情報は維持される', async () => {
    const requestSlot = async (template: { slot: number }, feedback: { mainLeverCorrection?: string }) => {
      if (template.slot === 4 && feedback.mainLeverCorrection) {
        return { project: validProject(4, { id: 'proj-stable-4', mainLever: 'COST' }) };
      }
      return { project: validProject(template.slot, template.slot === 4 ? { id: 'proj-stable-4', mainLever: 'x' } : {}) };
    };
    const projects = await generateSlotProjects({
      templates: ALL_SLOTS.map((slot) => ({ slot })), requestSlot, plan: reviewWith([]),
      allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '営業部',
    });
    const p4 = projects.find((p) => p.slot === 4);
    expect(p4.id).toBe('proj-stable-4');
    expect(p4.keyResults).toHaveLength(3);
    expect(p4.keyResults.map((k: any) => k.label)).toEqual(['再発注件数4', '手続き時間4', '提案件数4']);
    expect(p4.collaboration).toBe('連携先と分担を決める');
    expect(projects.find((p) => p.slot === 5).partnerDepartment).toBe('開発部');
    const full = validateCascadeReview(reviewWith(projects), PARTNERS, EVIDENCE, '営業部');
    expect(full).toEqual([]);
  });

  it('4. 修復された案も、プロジェクト全体の整合性検証（同名の重複など）を通る必要がある', async () => {
    const requestSlot = async (template: { slot: number }) =>
      template.slot === 2 ? { project: validProject(2, { title: '施策1' }) } : { project: validProject(template.slot) };
    await expect(
      generateSlotProjects({
        templates: [{ slot: 1 }, { slot: 2 }], requestSlot, plan: reviewWith([]),
        allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '営業部',
      }),
    ).resolves.toHaveLength(2);
    const dup = validateCascadeReview(reviewWith([validProject(1, { title: '同じ' }), validProject(2, { title: '同じ' })]), PARTNERS, EVIDENCE, '営業部');
    expect(dup.some((e) => e.endsWith('_duplicate_title'))).toBe(true);
  });

  it('スロットの応答が無い場合は、そのスロットの指摘を返す', () => {
    const r = reviewSlotCandidate(undefined, 3, CTX);
    expect(r.candidate).toBeUndefined();
    expect(r.errors).toContain('slot_3_missing');
  });
});

describe('人事部などの間接部門（mainLever と顧客成果の範囲）', () => {
  const ALL = [1, 2, 3, 4, 5].map((slot) => ({ slot }));
  const hrReview = (overrides: Record<number, Record<string, unknown>> = {}) =>
    reviewWith([1, 2, 3, 4, 5].map((slot) => validProject(slot, overrides[slot] ?? {})));

  it('[再現] 説明文の中に、効かせる指標のコードが1つだけあれば、そのコードとして扱う', () => {
    expect(normalizeMainLever('人材・組織（FUTURE）')).toBe('FUTURE');
    expect(normalizeMainLever('業務効率化：EFFICIENCY')).toBe('EFFICIENCY');
  });

  it('[再現] 複数のコードを並べた表記は、どれか1つに決めず、そのスロットの修復に回す', () => {
    expect(normalizeMainLever('ARPU / ACQ')).toBe('ARPU / ACQ');
    expect(normalizeMainLever('FUTURE・EFFICIENCY')).toBe('FUTURE・EFFICIENCY');
    expect(normalizeMainLever('人材育成')).toBe('人材育成');
  });

  it('[再現] 2回とも不適切な mainLever のスロットは slot_2_lever のまま。修復の指示には前回の値を示す', async () => {
    const seen: Array<{ prev: unknown; correction?: string }> = [];
    const requestSlot = async (template: { slot: number }, feedback: { mainLeverCorrection?: string; previousCandidate: any }) => {
      if (template.slot !== 2) return { project: validProject(template.slot) };
      seen.push({ prev: feedback.previousCandidate?.mainLever, correction: feedback.mainLeverCorrection });
      return { project: validProject(2, { mainLever: seen.length === 1 ? '人材育成' : 'FUTURE・EFFICIENCY' }) };
    };
    await expect(
      generateSlotProjects({ templates: [{ slot: 1 }, { slot: 2 }], requestSlot, plan: reviewWith([]), allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '人事部', indirect: true }),
    ).rejects.toThrow('slot_2_lever');
    expect(seen).toHaveLength(2);
    expect(seen[1].correction).toContain(MAIN_LEVER_CORRECTION);
    expect(seen[1].correction).toContain('人材育成');
  });

  it('修復で1つのコードに決まれば、そのスロットだけを作り直して通る', async () => {
    const calls: Record<number, number> = {};
    const requestSlot = async (template: { slot: number }) => {
      calls[template.slot] = (calls[template.slot] ?? 0) + 1;
      if (template.slot === 2) return { project: validProject(2, { mainLever: calls[2] === 1 ? '人材育成' : 'FUTURE' }) };
      return { project: validProject(template.slot) };
    };
    const projects = await generateSlotProjects({ templates: ALL, requestSlot, plan: reviewWith([]), allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '人事部', indirect: true });
    expect(projects.find((p) => p.slot === 2).mainLever).toBe('FUTURE');
    expect(calls).toEqual({ 1: 1, 2: 2, 3: 1, 4: 1, 5: 1 });
  });

  it('[再現] 間接部門は、顧客の代わりに支援先部門の成果（internal_process）で顧客成果を示せる。通常の部門では顧客の成果が必須のまま', () => {
    const supportKr = [
      keyResult('business_outcome', '全社の売上への寄与'),
      { ...keyResult('customer_outcome', '営業部の提案準備時間'), measurementScope: 'internal_process' },
      keyResult('leading', '研修後の実施件数'),
    ];
    const review = hrReview({ 2: { keyResults: supportKr } });
    expect(validateCascadeReview(review, PARTNERS, EVIDENCE, '人事部', { indirect: true })).toEqual([]);
    expect(validateCascadeReview(review, PARTNERS, EVIDENCE, '営業部')).toContain('slot_2_customer_and_business_outcomes');
  });

  it('間接部門でも、支援先の成果を測らない顧客成果の指標は通さない（基準を緩めない）', () => {
    const review = hrReview({ 2: { keyResults: [
      keyResult('business_outcome', '全社の売上への寄与'),
      { ...keyResult('customer_outcome', '社内の満足度'), measurementScope: 'own_business' },
      keyResult('leading', '研修後の実施件数'),
    ] } });
    expect(validateCascadeReview(review, PARTNERS, EVIDENCE, '人事部', { indirect: true })).toContain('slot_2_customer_and_business_outcomes');
  });
});

describe('人事部（間接部門）の初回生成のモック検証', () => {
  const HR_LEVER: Record<number, string> = { 1: 'FUTURE', 2: 'EFFICIENCY', 3: 'FUTURE', 4: 'COST', 5: 'FUTURE' };
  const hrProject = (slot: number) =>
    validProject(slot, slot === 3 ? { mainLever: HR_LEVER[3] } : {
      title: `人材施策${slot}`,
      mainLever: HR_LEVER[slot],
      keyResults: [
        keyResult('business_outcome', `全社の業績への寄与${slot}`),
        { ...keyResult('customer_outcome', `営業部の提案準備時間${slot}`), measurementScope: 'internal_process' },
        keyResult('leading', `研修後の実施件数${slot}`),
      ],
    });

  it('1. 人事部の初回生成は、支援先部門の成果を使って品質検証を通過する', async () => {
    const projects = await generateSlotProjects({
      templates: ALL_SLOTS.map((slot) => ({ slot })), requestSlot: async (template) => ({ project: hrProject(template.slot) }),
      plan: reviewWith([]), allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: '人事部', indirect: true,
    });
    expect(projects).toHaveLength(5);
    expect(validateCascadeReview(reviewWith(projects), PARTNERS, EVIDENCE, '人事部', { indirect: true })).toEqual([]);
  });

  it('2. 人事部の各施策は、効かせる指標（mainLever）と成果分類（business_outcome・customer_outcome・leading）が設定される', () => {
    const projects = [1, 2, 3, 4, 5].map(hrProject);
    expect(projects.map((p) => p.mainLever)).toEqual(['FUTURE', 'EFFICIENCY', 'FUTURE', 'COST', 'FUTURE']);
    for (const p of projects.filter((p) => p.slot !== 3)) {
      expect(p.keyResults.map((k: any) => k.kind)).toEqual(['business_outcome', 'customer_outcome', 'leading']);
      expect(p.keyResults[0].measurementScope).toBe('own_business');
      expect(p.keyResults[1].measurementScope).toBe('internal_process');
    }
  });
});

describe("[再現] 修復しても同じ不正値が返る場合の診断", () => {
  it("試行ごとに、AIが返した値・指摘を記録し、修復は該当スロットだけで行う", async () => {
    const diagnostics: any[] = [];
    const calls: Record<number, number> = {};
    const requestSlot = async (template: { slot: number }) => {
      calls[template.slot] = (calls[template.slot] ?? 0) + 1;
      return template.slot === 2
        ? { project: validProject(2, { mainLever: "6コードのうち施策が効かせる1つ" }) }
        : { project: validProject(template.slot) };
    };
    await expect(
      generateSlotProjects({
        templates: [{ slot: 1 }, { slot: 2 }], requestSlot, plan: reviewWith([]),
        allowedPartners: PARTNERS, finalStrategy: EVIDENCE, department: "人事部", indirect: true, diagnostics,
      }),
    ).rejects.toThrow("slot_2_lever");
    expect(calls).toEqual({ 1: 1, 2: 2 });
    const slot2 = diagnostics.filter((d) => d.slot === 2);
    expect(slot2.map((d) => d.attempt)).toEqual([1, 2]);
    expect(slot2.map((d) => d.rawMainLever)).toEqual(["6コードのうち施策が効かせる1つ", "6コードのうち施策が効かせる1つ"]);
    expect(slot2[0].errors).toEqual(["slot_2_lever"]);
    expect(diagnostics.filter((d) => d.slot === 1)).toHaveLength(1);
  });
});
