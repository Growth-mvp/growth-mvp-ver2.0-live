import { buildStage3BridgeBlock, BRIDGE_CHAR_BUDGET } from './stage3Context';

const PLACEHOLDER = 'kpiCriteriaの情報が生成されませんでした';
const DEFAULT_RULES = [
  '各部門ミッションは戦略の芯に対する自部門の役割を明記する',
  '各プロジェクトは重点領域または保持すべきテーマに接続する',
  'KPIは顧客価値・資源配分・行動変化を測る指標にする',
];

function strategyWith(bridge: Record<string, any> | null | undefined, extra: Record<string, any> = {}) {
  return { id: 'strategy-a', companyName: 'モック株式会社', ...extra, stage3_strategy_bridge: bridge };
}

const AI_BRIDGE = {
  keyThemes: ['保守の標準化を全社の重点にする', '点検の確実さを顧客価値の中心に置く'],
  departmentIssues: ['保守技術者の育成と、現場記録の共有が部門をまたぐ課題'],
  kpiCriteria: ['見直すべき事業：部品販売の縮小'],
  commonBehaviorChanges: ['点検記録を当日中に共有する'],
  strategicCore: {
    primaryShift: '属人的な点検から、標準化された点検へ転換する',
    concreteDomains: ['地域の中小製造業向け点検'],
    customerValue: '設備停止を減らす確実な点検',
    coreCapabilities: ['蓄積した保守記録のノウハウ'],
    portfolioShift: '部品販売の人員を点検へ移す',
    behaviorChange: '判断基準を文書にする',
    nonNegotiableThemes: ['点検の確実さ'],
  },
  departmentTranslationRules: ['点検部門は標準手順を運用する'],
  generatedAt: '2026-10-01T10:00:00.000Z',
};

describe('許可項目の抽出', () => {
  it('許可された5項目の内容を含む', () => {
    const r = buildStage3BridgeBlock(strategyWith(AI_BRIDGE));
    expect(r.state).toBe('present');
    expect(r.text).toContain('属人的な点検から、標準化された点検へ転換する');
    expect(r.text).toContain('重要テーマ（生成結果）: 保守の標準化を全社の重点にする、点検の確実さを顧客価値の中心に置く');
    expect(r.text).toContain('部門横断の論点（生成結果）');
    expect(r.text).toContain('社員・部門に求める行動変化（生成結果）: 点検記録を当日中に共有する');
    expect(r.text).toContain('部門展開のルール（生成結果）: 点検部門は標準手順を運用する');
    expect(r.included).toEqual(expect.arrayContaining(['strategicCore', 'keyThemes', 'departmentIssues', 'commonBehaviorChanges', 'departmentTranslationRules']));
  });

  it('KPIは確定値として扱わず、kpiCriteriaの内容は出さない', () => {
    const r = buildStage3BridgeBlock(strategyWith(AI_BRIDGE));
    expect(r.text).not.toContain('見直すべき事業');
    expect(r.text).not.toContain('部品販売の縮小');
    expect(r.text).not.toMatch(/KPI.*：/);
    expect(r.included).not.toContain('kpiCriteria');
  });

  it('許可されていない他のフィールド（部門・プロジェクト・担当者）は含めない', () => {
    const r = buildStage3BridgeBlock(
      strategyWith(AI_BRIDGE, {
        departments: [{ id: 'dept-1', name: '経理総務部', ownerName: '山田太郎', projects: [{ title: '秘密プロジェクト' }] }],
        executionPlans: [{ departmentId: 'dept-1' }],
      })
    );
    expect(r.text).not.toContain('経理総務部');
    expect(r.text).not.toContain('山田太郎');
    expect(r.text).not.toContain('秘密プロジェクト');
  });
});

describe('既定値・代替文の除外', () => {
  it('生成失敗時の代替文（情報が生成されませんでした）を除外する', () => {
    const r = buildStage3BridgeBlock(
      strategyWith({ ...AI_BRIDGE, keyThemes: [PLACEHOLDER], departmentIssues: ['部門横断の論点が実在する'] })
    );
    expect(r.text).not.toContain('情報が生成されませんでした');
    expect(r.text).toContain('部門横断の論点（生成結果）: 部門横断の論点が実在する');
  });

  it('保存時の既定ルール（3文の固定値）は、利用できる内容として扱わない', () => {
    const r = buildStage3BridgeBlock(
      strategyWith({ keyThemes: ['テーマA'], departmentIssues: [], commonBehaviorChanges: [], departmentTranslationRules: DEFAULT_RULES })
    );
    expect(r.text).not.toContain('部門展開のルール');
    for (const rule of DEFAULT_RULES) expect(r.text).not.toContain(rule);
  });

  it('既定ルールに、生成されたルールが混ざっている場合は、生成されたルールだけを残す', () => {
    const r = buildStage3BridgeBlock(
      strategyWith({ keyThemes: [], departmentIssues: [], commonBehaviorChanges: [], departmentTranslationRules: [...DEFAULT_RULES, '生成されたルール'] })
    );
    expect(r.text).toContain('部門展開のルール（生成結果）: 生成されたルール');
    expect(r.text).not.toContain(DEFAULT_RULES[0]);
  });

  it('保存時に派生した strategicCore（既定値と一致する項目）は除外する', () => {
    const derived = {
      keyThemes: ['テーマ1', 'テーマ2'],
      departmentIssues: ['課題1'],
      kpiCriteria: ['指標1'],
      commonBehaviorChanges: ['行動1'],
      strategicCore: {
        primaryShift: 'テーマ1',
        concreteDomains: ['課題1'],
        customerValue: 'テーマ2',
        coreCapabilities: ['テーマ1', 'テーマ2'],
        portfolioShift: '指標1',
        behaviorChange: '行動1',
        nonNegotiableThemes: ['課題1', 'テーマ1', 'テーマ2'],
      },
    };
    const r = buildStage3BridgeBlock(strategyWith(derived));
    expect(r.text).not.toContain('既存からの転換');
    expect(r.text).not.toContain('顧客にとっての価値');
    expect(r.text).not.toContain('経営資源・事業の移し方');
    expect(r.text).not.toContain('戦略を支える強み');
    expect(r.text).not.toContain('保持すべきテーマ');
    expect(r.text).toContain('重要テーマ（生成結果）: テーマ1、テーマ2');
  });
});

describe('文字数上限', () => {
  it('既定の上限は1,500文字', () => {
    expect(BRIDGE_CHAR_BUDGET).toBe(1500);
  });

  it('大きな入力でも上限を超えず、省略した件数を明示する', () => {
    const long = '非常に長い内容です。'.repeat(20);
    const big = {
      ...AI_BRIDGE,
      keyThemes: Array.from({ length: 8 }, () => long),
      departmentIssues: Array.from({ length: 8 }, () => long),
      commonBehaviorChanges: Array.from({ length: 8 }, () => long),
    };
    const r = buildStage3BridgeBlock(strategyWith(big));
    expect(r.text.length).toBeLessThanOrEqual(BRIDGE_CHAR_BUDGET);
    expect(r.omitted).toBeGreaterThan(0);
    expect(r.text).toContain(`（上限のため${r.omitted}件を省略）`);
  });
});

describe('未登録の場合の扱い', () => {
  it('橋渡しがない場合は、登録なしと示し、内容を推測させない', () => {
    const r = buildStage3BridgeBlock(strategyWith(null));
    expect(r.state).toBe('absent');
    expect(r.text).toContain('STAGE3の戦略展開ブリッジは登録されていません');
    expect(r.text).toContain('推測で補わない');
  });

  it('既定値・代替文しかない場合は、利用できる内容がないと示す', () => {
    const r = buildStage3BridgeBlock(
      strategyWith({ keyThemes: [PLACEHOLDER], departmentIssues: [], commonBehaviorChanges: [], departmentTranslationRules: DEFAULT_RULES })
    );
    expect(r.state).toBe('absent');
    expect(r.text).toContain('利用できる内容がありません');
  });

  it('strategy が無い場合も安全に扱う', () => {
    expect(buildStage3BridgeBlock(null).state).toBe('absent');
  });
});

describe('表示上の位置づけ', () => {
  it('AI生成・保存済みであり、経営者の承認や採用の記録ではないと明示する', () => {
    const r = buildStage3BridgeBlock(strategyWith(AI_BRIDGE));
    expect(r.text).toContain('AI生成・保存済みの内容');
    expect(r.text).toContain('経営者が承認・採用した記録ではありません');
    expect(r.text).toContain('STAGE2の経営者の意図・確定ストーリーとは別');
    expect(r.text).not.toContain('承認済み');
  });

  it('部門の役割・担当者・KPIとは結びつけないよう指示する', () => {
    const r = buildStage3BridgeBlock(strategyWith(AI_BRIDGE));
    expect(r.text).toContain('部門との対応関係を判断できません');
  });

  it('IDや部門名の対応を推測で作らない（生成結果に無いIDは出さない）', () => {
    const r = buildStage3BridgeBlock(strategyWith(AI_BRIDGE, { departments: [{ id: 'dept-zzz', name: '営業部' }] }));
    expect(r.text).not.toContain('dept-zzz');
    expect(r.text).not.toContain('営業部');
  });
});
