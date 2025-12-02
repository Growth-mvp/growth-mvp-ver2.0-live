// /lib/strategyPatterns.catalog.ts

import type { KRKind } from '@/types/strategy';

/* ============================================================
 * 基本型定義
 * ============================================================ */

export type GrowthLever =
  | 'ACQ'        // 新規獲得
  | 'ARPU'       // 単価
  | 'CHURN'      // 解約・維持
  | 'COST'       // コスト全般
  | 'INVEST'     // 投資・将来
  | 'SYNERGY';   // シナジー・横串

export type IndustryCode =
  | 'SAAS'
  | 'MANUFACTURING'
  | 'RETAIL'
  | 'SERVICE'
  | 'FINANCE'
  | 'OTHER';

export type DepartmentKind =
  | 'SALES'
  | 'MARKETING'
  | 'CUSTOMER_SUCCESS'
  | 'HR'
  | 'GENERAL_AFFAIRS'
  | 'PRODUCTION'
  | 'FINANCE_DEPT'
  | 'CORPORATE'
  | 'IT'
  | 'OTHER';

/**
 * 間接部門などが「どのレバーを支えているか」を示すメタ情報
 */
export type BridgeMode = 'direct' | 'indirect';

/**
 * プレーンなKRテンプレート
 * - ここではまだ「文章＋ヒント」レベルに留めておく
 * - OKR画面で部門長＆現場が議論して具体化
 */
export type KRPlainTemplate = {
  /** KRの種別（ACQ/ARPU/CHURN/COST_... など） */
  kind: KRKind;
  /** プレーンな文言（{segment} 等のプレースホルダ含んでよい） */
  labelTemplate: string;
  /** どのレバーにどう効くか */
  lever: GrowthLever;
  mode: BridgeMode;
  /**
   * 目標値のイメージ（例: "200", "5", "-0.5"）
   * 実際の数値はOKR画面で決める
   */
  targetHint?: string;
};

/**
 * 勝ち筋カタログの1エントリ（業種×部門×レバー別）
 */
export type ProjectPattern = {
  id: string;
  industry: IndustryCode | 'ANY';
  departmentKind: DepartmentKind;
  lever: GrowthLever;

  /** プロジェクト名テンプレート（{segment}/{channel}/{product} を含んでも良い） */
  titleTemplate: string;

  /** 補足説明（任意） */
  descriptionTemplate?: string;

  /** デフォルトのタグ類（ユーザー入力があればそちら優先） */
  defaultSegment: string;
  defaultChannel: string;
  defaultProduct: string;

  /** このプロジェクトに紐づくOKRテンプレート群（通常は1つでOK） */
  okrTemplates: {
    objectiveTemplate: string;
    krTemplates: KRPlainTemplate[];
  }[];
};

/**
 * 実際にカスケードへ流し込むための「生成済プロジェクト」型
 * - /store/strategyStore.ts の Department.projects[] に変換しやすい構造
 */
export type GeneratedProject = {
  title: string;
  description?: string;
  segment: string;
  channel: string;
  product: string;
  lever: GrowthLever;
  mode: BridgeMode; // このプロジェクト全体のモード（KRが混在する場合は direct 優先）

  objective: string;
  keyResults: string[]; // プレーンなKR文（詳細はOKR画面で詰める）
};

/* ============================================================
 * カタログ本体（まずは代表例だけ定義 ⇒ 追加拡張していける構造）
 * ============================================================ */

export const PROJECT_PATTERNS: ProjectPattern[] = [
  /* ---------- SaaS × 営業 × ACQ（新規獲得） ---------- */
  {
    id: 'saas-sales-acq-1',
    industry: 'SAAS',
    departmentKind: 'SALES',
    lever: 'ACQ',
    titleTemplate:
      '{segment}向け{product}を、{channel}で新規獲得するプロジェクト',
    descriptionTemplate:
      'ターゲットセグメントを絞り込み、オンライン中心に新規商談数を増やすことで、ARRベースの売上成長を狙う。',
    defaultSegment: '中堅BtoB企業',
    defaultChannel: 'インサイドセールス/オンライン',
    defaultProduct: '主力SaaSプラン',

    okrTemplates: [
      {
        objectiveTemplate:
          '{segment}向け{product}の新規商談パイプラインを拡大し、ARR成長の軸をつくる',
        krTemplates: [
          {
            kind: 'ACQ',
            labelTemplate:
              '{segment}向けの新規商談を月{target}件創出する（{channel}経由）',
            lever: 'ACQ',
            mode: 'direct',
            targetHint: '30',
          },
          {
            kind: 'ACQ',
            labelTemplate:
              '{channel}経由のSQL転換率を{target}%まで引き上げる',
            lever: 'ACQ',
            mode: 'direct',
            targetHint: '15',
          },
          {
            kind: 'SUCCESS_RATE',
            labelTemplate:
              '重点ターゲット{segment}に対する提案Win率を{target}%まで高める',
            lever: 'ACQ',
            mode: 'direct',
            targetHint: '35',
          },
        ],
      },
    ],
  },

  /* ---------- SaaS × 営業 × ARPU（単価） ---------- */
  {
    id: 'saas-sales-arpu-1',
    industry: 'SAAS',
    departmentKind: 'SALES',
    lever: 'ARPU',
    titleTemplate:
      '{segment}既存顧客向けに{product}のアップセル・クロスセルを強化するプロジェクト',
    descriptionTemplate:
      '既存顧客の利用状況と潜在ニーズを可視化し、単価向上とチャーン抑制の両立を図る。',
    defaultSegment: '既存大口顧客',
    defaultChannel: 'カスタマーサクセス/アカウント営業',
    defaultProduct: '上位プラン＋追加オプション',

    okrTemplates: [
      {
        objectiveTemplate:
          '{segment}の既存顧客単価を高め、継続率とLTVを同時に引き上げる',
        krTemplates: [
          {
            kind: 'ARPU',
            labelTemplate:
              '{segment}の平均月額単価を{target}%向上させる（{product}の導入を通じて）',
            lever: 'ARPU',
            mode: 'direct',
            targetHint: '15',
          },
          {
            kind: 'CHURN',
            labelTemplate:
              '{segment}のチャーン率を{target}ポイント改善する',
            lever: 'CHURN',
            mode: 'direct',
            targetHint: '-0.5',
          },
        ],
      },
    ],
  },

  /* ---------- 製造業 × 生産 × COST ---------- */
  {
    id: 'mfg-production-cost-1',
    industry: 'MANUFACTURING',
    departmentKind: 'PRODUCTION',
    lever: 'COST',
    titleTemplate:
      '主力製品ラインの不良率削減と稼働率向上による製造コスト最適化プロジェクト',
    descriptionTemplate:
      '不良の主要因を特定し、段取り・品質管理の改善を通じて歩留まりを改善する。',
    defaultSegment: '主力製品ライン',
    defaultChannel: '生産ライン/現場改善',
    defaultProduct: '主力製品',

    okrTemplates: [
      {
        objectiveTemplate:
          '主力製品ラインの不良率と段取りロスを削減し、製造コストを構造的に下げる',
        krTemplates: [
          {
            kind: 'COST_VARIABLE',
            labelTemplate: '不良率を{target}%まで削減する',
            lever: 'COST',
            mode: 'direct',
            targetHint: '1.0',
          },
          {
            kind: 'COST_VARIABLE',
            labelTemplate:
              '段取り時間を{target}%削減し、稼働率を向上させる',
            lever: 'COST',
            mode: 'direct',
            targetHint: '10',
          },
        ],
      },
    ],
  },

  /* ---------- 人事 × ACQ支援（間接部門） ---------- */
  {
    id: 'hr-acq-support-1',
    industry: 'ANY',
    departmentKind: 'HR',
    lever: 'ACQ',
    titleTemplate:
      '営業部のACQレバーを支える採用・オンボーディング強化プロジェクト',
    descriptionTemplate:
      '新規営業人材の採用と立ち上がり生産性を高めることで、ACQ施策の実行能力を底上げする。',
    defaultSegment: '営業組織',
    defaultChannel: '採用/育成',
    defaultProduct: '営業人材',

    okrTemplates: [
      {
        objectiveTemplate:
          '営業部の新規獲得力を高めるために、採用とオンボーディングを強化する',
        krTemplates: [
          {
            kind: 'PERSONNEL',
            labelTemplate:
              'ターゲットプロファイルに合致する営業人材を{target}名採用する',
            lever: 'ACQ',
            mode: 'indirect',
            targetHint: '5',
          },
          {
            kind: 'SUCCESS_RATE',
            labelTemplate:
              '入社6ヶ月以内の新人営業の平均受注件数を既存比{target}%に引き上げる',
            lever: 'ACQ',
            mode: 'indirect',
            targetHint: '80',
          },
          {
            kind: 'CHURN',
            labelTemplate:
              '営業組織のキープレイヤー離職率を{target}%まで抑える',
            lever: 'ACQ',
            mode: 'indirect',
            targetHint: '3',
          },
        ],
      },
    ],
  },

  /* ---------- 総務・コーポレート × COST支援（間接部門） ---------- */
  {
    id: 'corp-cost-support-1',
    industry: 'ANY',
    departmentKind: 'GENERAL_AFFAIRS',
    lever: 'COST',
    titleTemplate:
      'オフィスコストと非コア業務の見直しによる固定費最適化プロジェクト',
    descriptionTemplate:
      'オフィス・備品・外注費などの固定費構造を見直し、成長投資へ回せる原資をつくる。',
    defaultSegment: '本社・主要拠点',
    defaultChannel: '契約/オペレーション',
    defaultProduct: 'オフィス関連サービス',

    okrTemplates: [
      {
        objectiveTemplate:
          '成長投資に回せる原資を捻出するために、オフィス関連の固定費を最適化する',
        krTemplates: [
          {
            kind: 'COST_FIXED',
            labelTemplate:
              'オフィス関連固定費を年間{target}万円削減する',
            lever: 'COST',
            mode: 'direct',
            targetHint: '1200',
          },
          {
            kind: 'COST_FIXED',
            labelTemplate:
              '非コア業務のアウトソース比率を{target}%まで高める',
            lever: 'COST',
            mode: 'indirect',
            targetHint: '30',
          },
        ],
      },
    ],
  },
];

/* ============================================================
 * 生成エンジン
 * ============================================================ */

export type ProjectGenerationInput = {
  industry: IndustryCode;
  departmentKind: DepartmentKind;

  /** レバーの優先度（先頭が最優先）。1〜2件推奨。 */
  leverPriority: GrowthLever[];

  /** ストーリー・ミッションなどのテキスト（将来のチューニング用／今は軽いスコア加点に使う） */
  missionText?: string;
  storyText?: string;

  /** ユーザーが既に決めたタグ（あれば優先） */
  preferredSegment?: string;
  preferredChannel?: string;
  preferredProduct?: string;

  /** 生成したい最大プロジェクト数（デフォルト 3） */
  maxProjects?: number;
};

export function generateProjectsForDepartment(
  input: ProjectGenerationInput,
): GeneratedProject[] {
  const {
    industry,
    departmentKind,
    leverPriority,
    missionText,
    storyText,
    preferredSegment,
    preferredChannel,
    preferredProduct,
    maxProjects = 3,
  } = input;

  if (!leverPriority || leverPriority.length === 0) return [];

  // 1. 業種＆部門＆レバーでカタログをフィルタ
  const candidates = PROJECT_PATTERNS.filter((p) => {
    if (p.departmentKind !== departmentKind) return false;
    if (!(p.industry === 'ANY' || p.industry === industry)) return false;
    if (!leverPriority.includes(p.lever)) return false;
    return true;
  });

  if (candidates.length === 0) return [];

  // 2. 簡易スコアリング
  const fullText = `${missionText ?? ''}\n${storyText ?? ''}`.toLowerCase();

  const scored = candidates
    .map((p) => {
      let score = 0;

      // レバー優先度（先頭レバーに高得点）
      const leverIdx = leverPriority.indexOf(p.lever);
      if (leverIdx >= 0) {
        score += (leverPriority.length - leverIdx) * 10;
      }

      // ミッション／ストーリー中のキーワードをざっくり見る
      if (fullText) {
        if (p.lever === 'ACQ') {
          if (fullText.match(/新規|開拓|リード|商談|見込み/)) score += 5;
        }
        if (p.lever === 'ARPU') {
          if (fullText.match(/単価|アップセル|クロスセル|既存顧客/)) score += 5;
        }
        if (p.lever === 'CHURN') {
          if (fullText.match(/解約|離脱|維持|継続/)) score += 5;
        }
        if (p.lever === 'COST') {
          if (fullText.match(/コスト|費用|効率|生産性|不良/)) score += 5;
        }
        if (p.lever === 'INVEST') {
          if (fullText.match(/投資|新規事業|研究開発|R&D/i)) score += 5;
        }
        if (p.lever === 'SYNERGY') {
          if (fullText.match(/連携|横串|シナジー|コラボ/)) score += 5;
        }
      }

      return { pattern: p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxProjects);

  // 3. テンプレを実際のプロジェクト構造に変換
  const segment = preferredSegment || scored[0]?.pattern.defaultSegment || '';
  const channel = preferredChannel || scored[0]?.pattern.defaultChannel || '';
  const product = preferredProduct || scored[0]?.pattern.defaultProduct || '';

  const replaceTokens = (tmpl: string | undefined): string =>
    (tmpl || '')
      .replace(/\{segment\}/g, segment)
      .replace(/\{channel\}/g, channel)
      .replace(/\{product\}/g, product)
      .replace(/\{target\}/g, ''); // targetはOKR画面で決めるため、ここでは空

  const results: GeneratedProject[] = [];

  for (const { pattern } of scored) {
    const okrTemplate = pattern.okrTemplates[0];
    if (!okrTemplate) continue;

    const objective = replaceTokens(okrTemplate.objectiveTemplate);
    const keyResults = okrTemplate.krTemplates.map((kr) =>
      replaceTokens(kr.labelTemplate),
    );

    // プロジェクト全体のモードは「directが1つでもあればdirect、なければindirect」
    const mode: BridgeMode =
      okrTemplate.krTemplates.some((kr) => kr.mode === 'direct')
        ? 'direct'
        : 'indirect';

    results.push({
      title: replaceTokens(pattern.titleTemplate),
      description: replaceTokens(pattern.descriptionTemplate),
      segment,
      channel,
      product,
      lever: pattern.lever,
      mode,
      objective,
      keyResults,
    });
  }

  return results;
}
