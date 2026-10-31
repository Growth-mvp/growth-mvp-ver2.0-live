import { matchCompanyMarkets } from '../marketTaxonomy';
import { isCustomerNeedDiscoveryEnabled } from './flags';
import { NEED_THEMES, selectedNeedThemes } from './catalog';
import { buildNeedSearchPlan } from './searchPlan';
import { buildRoleAnalysisInput, parseRoleAnalysis, roleCoverage, ROLE_KEYS, type CustomerRole } from './roles';
import {
  completeNeedHypothesis,
  gradeNeedHypothesis,
  specChecks,
  type NeedHypothesis,
} from './hypothesis';
import { assessSurvey, type SurveyRecord } from './survey';
import { buildCandidatePool, parseCandidatePool } from '../candidatePool';
import { FIXTURES } from './fixtures';

const matchOf = (f: (typeof FIXTURES)[keyof typeof FIXTURES]) =>
  matchCompanyMarkets({
    businessContent: f.businessContent,
    segments: (f.segments ?? []).map((s) => ({
      revenue: 1000,
      productTexts: [s.name ?? '', s.summary ?? '', ...(s.mainProductsServices ?? [])],
      customerTexts: s.keyCustomers ?? [],
    })),
  });

describe('機能フラグ', () => {
  it('既定相当（未設定）と "true" 以外では OFF。"true" のときだけ ON', () => {
    expect(isCustomerNeedDiscoveryEnabled(undefined)).toBe(false);
    expect(isCustomerNeedDiscoveryEnabled('')).toBe(false);
    expect(isCustomerNeedDiscoveryEnabled('TRUE')).toBe(false);
    expect(isCustomerNeedDiscoveryEnabled('1')).toBe(false);
    expect(isCustomerNeedDiscoveryEnabled('true')).toBe(true);
  });
});

describe('探索テーマ（固定カタログ）', () => {
  it('肯定的な証拠と否定的な証拠の両方を、同じ件数で含む', () => {
    const themes = selectedNeedThemes();
    expect(themes.length).toBe(6);
    expect(themes.some((t) => t.polarity === 'supporting')).toBe(true);
    expect(themes.some((t) => t.polarity === 'disconfirming')).toBe(true);
  });

  it('テーマの文に、企業名・プレースホルダ・自由記述の欄の名前を含まない', () => {
    for (const t of NEED_THEMES) {
      expect(t.theme).not.toMatch(/[{}]|株式会社|SECRET|事業名|顧客名/);
    }
  });
});

describe('検索テンプレート（Web検索へ送る内容）', () => {
  it('業界名が無ければ業界の行を出さず、公開分類とテーマだけで組み立てる', () => {
    const plan = buildNeedSearchPlan({ industryLabel: '', regions: [], match: matchOf(FIXTURES.canMaker) });
    expect(plan).not.toBeNull();
    expect(plan!.input).not.toContain('業界:');
    expect(plan!.input).toContain('製品・顧客市場（公開分類）:');
    expect(plan!.input).toContain('利用者の不満が小さい');
    expect(plan!.id).toBe('customer_need');
  });

  it('社内の文言（概要・顧客の自由記述・役割の文）は検索入力に入らない', () => {
    const secret = {
      ...FIXTURES.canMaker,
      segments: [
        {
          ...FIXTURES.canMaker.segments![0],
          summary: 'SECRET-SUMMARY-9001 18L缶の製造',
          keyCustomers: ['SECRET-CUSTOMER-9002', '塗料メーカー'],
        },
      ],
      businessContent: 'SECRET-CONTENT-9003 金属缶の製造',
    };
    const plan = buildNeedSearchPlan({ industryLabel: '', regions: [], match: matchOf(secret) });
    for (const s of ['SECRET-SUMMARY-9001', 'SECRET-CUSTOMER-9002', 'SECRET-CONTENT-9003']) {
      expect(plan!.input).not.toContain(s);
    }
    const roles = parseRoleAnalysis({
      roles: [{ role: 'user', basis: 'estimated', label: 'SECRET-ROLE-9004', evidence: null }],
    });
    expect(plan!.input).not.toContain(roles[0].label);
  });

  it('一致する分類が無ければ検索テンプレートを作らない（確認できないものを探さない）', () => {
    const plan = buildNeedSearchPlan({ industryLabel: '', regions: [], match: matchOf(FIXTURES.unconfirmed) });
    expect(plan).toBeNull();
  });
});

describe('顧客の多層構造（内部分析の入力と出力の検査）', () => {
  it('内部分析の入力には、4つの役割と「無理に埋めない」指示を含む', () => {
    const input = buildRoleAnalysisInput(FIXTURES.canMaker);
    for (const k of ROLE_KEYS) expect(input).toContain(k);
    expect(input).toContain('無理に埋めない');
    expect(input).toContain('塗料メーカー');
  });

  it('根拠の無い input / public は estimated に降格し、不正な役割は捨て、役割ごとに3件まで', () => {
    const roles = parseRoleAnalysis({
      roles: [
        { role: 'direct_customer', basis: 'input', label: '塗料メーカー', evidence: '主要顧客欄' },
        { role: 'direct_customer', basis: 'input', label: '根拠なし', evidence: null },
        { role: 'user', basis: 'public', label: '塗装業者', evidence: '' },
        { role: 'unknown_role', basis: 'input', label: '不正', evidence: 'x' },
        { role: 'end_beneficiary', basis: 'bogus', label: '不正な区分', evidence: null },
        { role: 'buying_decision_maker', basis: 'estimated', label: 'a', evidence: null },
        { role: 'buying_decision_maker', basis: 'estimated', label: 'b', evidence: null },
        { role: 'buying_decision_maker', basis: 'estimated', label: 'c', evidence: null },
        { role: 'buying_decision_maker', basis: 'estimated', label: 'd', evidence: null },
      ],
    });
    expect(roles.filter((r) => r.role === 'direct_customer').map((r) => r.basis)).toEqual(['input', 'estimated']);
    expect(roles.find((r) => r.role === 'user')).toMatchObject({ basis: 'estimated', evidence: null });
    expect(roles.some((r) => r.label === '不正')).toBe(false);
    expect(roles.filter((r) => r.role === 'buying_decision_maker')).toHaveLength(3);
    expect(parseRoleAnalysis('not an object')).toEqual([]);
  });

  it('確認できない役割は unconfirmed のまま残り、推測で埋めない（確認できない企業）', () => {
    const roles = parseRoleAnalysis({ roles: [] });
    expect(roleCoverage(roles)).toEqual({
      direct_customer: 'unconfirmed',
      user: 'unconfirmed',
      end_beneficiary: 'unconfirmed',
      buying_decision_maker: 'unconfirmed',
    });
  });

  it('入力の根拠の強さを役割ごとに示す（input > public > estimated > unconfirmed）', () => {
    const roles: CustomerRole[] = [
      { role: 'direct_customer', basis: 'input', label: '塗料メーカー', evidence: '主要顧客欄' },
      { role: 'user', basis: 'estimated', label: '塗装業者', evidence: null },
      { role: 'user', basis: 'public', label: '塗装業者', evidence: '業界団体の報告' },
    ];
    expect(roleCoverage(roles)).toMatchObject({
      direct_customer: 'input',
      user: 'public',
      end_beneficiary: 'unconfirmed',
    });
  });
});

describe('課題から機会への変換（根拠と仮説の区別）', () => {
  const base: NeedHypothesis = {
    id: 'h1',
    who: 'user',
    whoLabel: '塗装業者',
    roleBasis: 'estimated',
    problem: '18L缶の重さと開けにくさが、現場での持ち運びの負担になっている可能性',
    desiredOutcome: '少人数で一日の塗装作業を終えること',
    whyCurrentFails: null,
    breadth: 'unknown',
    payer: null,
    companyLink: '容器の容量と開口部の設計',
    opportunity: '現場の持ち運びと開封の負担を減らす容器仕様の選択肢',
    facts: [],
    hypotheses: ['現場の負担は推定'],
    unverified: [],
    discoveryPath: 'customer_need',
  };

  it('広がり・対価・出典が揃うまでは、公開情報で確認済みとしない', () => {
    const r = gradeNeedHypothesis(base);
    expect(r.grade).toBe('hypothesis');
    expect(r.reasons).toEqual(expect.arrayContaining(['課題の広がりを示す公開情報が未確認', '対価を払う相手が未確認']));
  });

  it('すべて揃い、事実に出典がある場合だけ verified_public', () => {
    const r = gradeNeedHypothesis({
      ...base,
      breadth: 'public_observed',
      payer: 'buying_decision_maker',
      facts: [{ text: '持ち運びの負担を挙げた利用者が一定数いる', sourceUrl: 'https://example.com/survey', bodyChecked: true }],
    });
    expect(r.grade).toBe('verified_public');
  });

  it('出典の無い事実がある場合は仮説に戻す', () => {
    const r = gradeNeedHypothesis({
      ...base,
      breadth: 'public_observed',
      payer: 'buying_decision_maker',
      facts: [{ text: '出典の無い事実', sourceUrl: null, bodyChecked: false }],
    });
    expect(r.grade).toBe('hypothesis');
    expect(r.reasons).toContain('事実に出典が付いていない');
  });

  it('URL があるだけで本文を確認していない事実は、公開情報で確認済みとしない', () => {
    const r = gradeNeedHypothesis({
      ...base,
      breadth: 'public_observed',
      payer: 'buying_decision_maker',
      companyLink: '容器の容量と開口部の設計',
      facts: [{ text: '持ち運びの負担を挙げた利用者が一定数いる', sourceUrl: 'https://example.com/survey', bodyChecked: false }],
    });
    expect(r.grade).toBe('hypothesis');
    expect(r.reasons).toContain('事実の出典は本文が未確認（URLだけでは確認済みとしない）');
  });

  it('欠けた任意項目は unverified に明示する', () => {
    const c = completeNeedHypothesis(base);
    expect(c.unverified).toEqual(expect.arrayContaining(['whyCurrentFails', 'payer', 'breadth']));
    expect(c.unverified).not.toContain('desiredOutcome');
    expect(c.unverified).not.toContain('companyLink');
  });

  it('課題の主体は、役割の根拠がある役割に限る（確認できない企業で役割を作らない）', () => {
    const none = parseRoleAnalysis({ roles: [] });
    expect(specChecks({ ...base, who: 'user' }, none).whoIsSupportedByRoles).toBe(false);
    const some = parseRoleAnalysis({ roles: [{ role: 'user', basis: 'estimated', label: '塗装業者', evidence: null }] });
    expect(specChecks({ ...base, who: 'user' }, some).whoIsSupportedByRoles).toBe(true);
  });
});

describe('公開調査の記録（根拠の確かさ）', () => {
  const full: SurveyRecord = {
    sourceUrl: 'https://example.com/survey',
    publisher: '業界団体',
    fieldPeriod: '2025年度',
    population: '塗装業者',
    sampleSize: 500,
    region: '国内',
    questionSummary: '容器の持ち運びに関する不満',
    customerRelation: 'same_customer',
    bodyChecked: true,
  };

  it('本文を確認し、対象が顧客と一致し、標本の情報が揃う場合だけ根拠として使える', () => {
    expect(assessSurvey(full).usableAsCustomerEvidence).toBe(true);
  });

  it('URL だけで本文を確認していない場合は、根拠として使わない', () => {
    const a = assessSurvey({ ...full, bodyChecked: false });
    expect(a.usableAsCustomerEvidence).toBe(false);
    expect(a.unverified).toContain('source_body_not_checked');
  });

  it('調査対象が自社の顧客と異なる場合は、根拠として使わず、その理由を残す', () => {
    const a = assessSurvey({ ...full, customerRelation: 'adjacent' });
    expect(a.usableAsCustomerEvidence).toBe(false);
    expect(a.unverified).toContain('customer_relation_adjacent');
  });

  it('取得できない項目は推測で埋めず、未確認として残す', () => {
    const a = assessSurvey({ ...full, sampleSize: null, fieldPeriod: null });
    expect(a.usableAsCustomerEvidence).toBe(false);
    expect(a.unverified).toEqual(expect.arrayContaining(['sample_size', 'field_period']));
  });
});

describe('仕様適合の検査（4事業の架空入力に同じ経路を適用）', () => {
  const cases = [
    {
      name: '日本製罐（塗料メーカーと塗装現場）',
      fixture: FIXTURES.canMaker,
      roles: [
        { role: 'direct_customer', basis: 'input', label: '塗料メーカー・化学品メーカー', evidence: '主要顧客欄' },
        { role: 'user', basis: 'estimated', label: '容器を扱う塗装業者', evidence: null },
        { role: 'end_beneficiary', basis: 'estimated', label: '塗装成果を得る顧客', evidence: null },
      ],
      who: 'user' as const,
    },
    {
      name: '店舗内装・改装（店舗経営者と来店客）',
      fixture: FIXTURES.storeInterior,
      roles: [
        { role: 'direct_customer', basis: 'input', label: '店舗経営者', evidence: '主要顧客欄' },
        { role: 'end_beneficiary', basis: 'estimated', label: '来店客', evidence: null },
      ],
      who: 'end_beneficiary' as const,
    },
    {
      name: 'IT・SaaS（導入決定者と利用者）',
      fixture: FIXTURES.saas,
      roles: [
        { role: 'buying_decision_maker', basis: 'input', label: '企業の人事部門', evidence: '主要顧客欄' },
        { role: 'user', basis: 'estimated', label: '勤怠を入力する従業員', evidence: null },
      ],
      who: 'user' as const,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: 役割は根拠つきで区別され、課題の主体は役割に存在する`, () => {
      const roles = parseRoleAnalysis({ roles: c.roles });
      expect(roleCoverage(roles)[c.who]).not.toBe('unconfirmed');
      const h = completeNeedHypothesis({
        id: `${c.who}-1`,
        who: c.who,
        whoLabel: c.roles.find((r) => r.role === c.who)!.label,
        roleBasis: roleCoverage(roles)[c.who] as 'input' | 'estimated',
        problem: '利用者が日々の作業で負担を感じている可能性がある具体的な場面',
        desiredOutcome: null,
        whyCurrentFails: null,
        breadth: 'unknown',
        payer: null,
        companyLink: null,
        opportunity: '負担を減らす選択肢の検討余地',
        facts: [],
        hypotheses: ['負担は推定'],
        unverified: [],
        discoveryPath: 'customer_need',
      });
      const checks = specChecks(h, roles);
      expect(checks).toMatchObject({ whoIsSupportedByRoles: true, factsHaveSources: true, factsAndHypothesesSeparated: true });
      expect(gradeNeedHypothesis(h).grade).toBe('hypothesis');
    });
  }

  it('顧客課題が確認できない企業（相談窓口）では、探索テーマも役割も作らない', () => {
    const plan = buildNeedSearchPlan({ industryLabel: '', regions: [], match: matchOf(FIXTURES.unconfirmed) });
    const roles = parseRoleAnalysis({ roles: [] });
    expect(plan).toBeNull();
    expect(Object.values(roleCoverage(roles)).every((v) => v === 'unconfirmed')).toBe(true);
  });
});

describe('候補の探索経路（既存の保存形式との互換）', () => {
  const NOW = '2026-10-31T00:00:00.000Z';
  const json = (v: unknown) => JSON.parse(JSON.stringify(v));

  it('探索経路の無い既存の候補一覧は、そのまま読める（経路は付けない）', () => {
    const pool = buildCandidatePool({ opportunity: ['機会A'], threat: ['脅威A'], generatedAt: NOW });
    const restored = parseCandidatePool(json(pool))!;
    expect(restored.candidates.every((c) => !('discoveryPath' in c))).toBe(true);
    expect(restored).toEqual(pool);
  });

  it('探索経路は保存・復元で残り、不正な値は経路だけを捨てて候補は残す', () => {
    const pool = buildCandidatePool({ opportunity: ['機会A', '機会B'], threat: [], generatedAt: NOW });
    const withPath = {
      ...pool,
      candidates: [
        { ...pool.candidates[0], discoveryPath: 'customer_need' },
        { ...pool.candidates[1], discoveryPath: 'bogus' },
      ],
    };
    const restored = parseCandidatePool(json(withPath))!;
    expect(restored.candidates).toHaveLength(2);
    expect(restored.candidates[0].discoveryPath).toBe('customer_need');
    expect(restored.candidates[1]).not.toHaveProperty('discoveryPath');
  });
});
