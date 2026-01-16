// /app/okr/_lib/okrModels.ts
import type {
  KRStructured,
  KRKind,
  GrowthLever,
  WinPatternId,
  KRScope,
  KRUnit,
  BaseKey,
} from '@/types/strategy';

/* ============================================================
 * ローカル型（store 依存を緩く）
 * - 「戦略的OKR」に必要なメタ（進化/探索、レバー、勝ち筋、仮説/検証）を
 *   ここ（モデル層）で保持できるようにする
 * ========================================================== */

/** 旧KR（文字列）互換 */
export type KR = string;

/** 進化/探索（戦略OKRの軸）
 * - evolve: 既存の勝ち筋を太くする（短期・確度高）
 * - explore: 新しい勝ち筋を探索する（不確実・学習重視）
 */
export type StrategyTrack = 'EVOLVE' | 'EXPLORE';

/** OKRの意図（Leading/Lagging/Learning）
 * - 戦略的OKRは「結果（Lagging）」だけでなく「先行（Leading）」と「学習（Learning）」を設計する
 */
export type MetricRole = 'LAGGING' | 'LEADING' | 'LEARNING';

/** 検証ステータス（探索に必須） */
export type ValidationStatus = 'not_started' | 'running' | 'validated' | 'invalidated';

/** 検証設計（探索OKR用：最小） */
export type ValidationPlan = {
  status?: ValidationStatus;
  hypothesis?: string; // 例: 「訪問数を増やせば、受注率が上がる」
  testMethod?: string; // 例: AB/PoC/パイロット/インタビュー
  evidence?: string; // 例: 定量/定性の根拠
  nextAction?: string; // 次の手
};

/** 旧OKR（文字列KR）互換維持 + 戦略メタ */
export type OKR = {
  objective: string;
  keyResults: KR[];
  owner?: string;
  due?: string;
  status?: string;

  /** 戦略メタ（任意） */
  track?: StrategyTrack;
  levers?: GrowthLever[];
  winPattern?: WinPatternId | 'primary' | 'secondary' | 'none';
  validation?: ValidationPlan;
};

export type ProjectRole = 'revenue' | 'cost' | 'future' | 'global';

export type Department = {
  name?: string;
  projects?: Project[];
  strategy?: string;
  mission?: string;

  /** 部門戦略の主戦場（任意） */
  winPatternPrimary?: WinPatternId;
  winPatternSecondary?: WinPatternId;
  focusLevers?: GrowthLever[];
};

/** プロジェクト（OKR画面で扱う最小ユニット） */
export type Project = {
  title?: string;
  name?: string;

  /** 旧：文字列OKR（互換用） */
  okrs?: OKR[];

  /** 新：構造化KR（財務ブリッジ用） */
  okrsV2?: KRStructuredX[];

  /** プロジェクトの役割（財務・UIのタグ） */
  role?: ProjectRole;

  /** 戦略メタ（任意） */
  track?: StrategyTrack;
  levers?: GrowthLever[];
  winPatternPrimary?: WinPatternId;
  winPatternSecondary?: WinPatternId;

  /** 進化/探索：探索バリアント */
  okrVariants?: OkrVariant[];
  activeVariantId?: string;
  okrRevision?: number;

  /** ★STAGE4 実行計画：計画ステータス（draft/review/approved） */
  planStatus?: 'draft' | 'review' | 'approved';

  /** ★STAGE4 実行計画：承認日時 */
  approvedAt?: string;

  /** ★STAGE4 実行計画：承認者ID */
  approvedBy?: string;

  /** ★STAGE4 実行計画：スキルプラン */
  skillPlans?: Array<{ id: string; skillName: string; priority?: number; method?: string; dueYm?: string; hours?: number; cost?: number; owner?: string; note?: string }>;

  /** ★STAGE4 実行計画：人的投資計画 */
  executionHumanInvestments?: Array<{ id: string; type: string; amount?: number; timingYm?: string; headcount?: number; team?: string; note?: string }>;
};

/* ============================================================
 * KRStructured 拡張（戦略OKRに必要なフィールド）
 * - types/strategy.ts の KRStructured を前提に、ここではUI編集に必要な拡張を足す
 * - 既存互換のため optional を維持
 * ========================================================== */
export type KRStructuredX = KRStructured & {
  /** 合成・変換・遅行 */
  weight?: number;
  elasticity?: number;
  lagMonths?: number;
  startYm?: string;
  notes?: string;

  /** ベース母数の扱い（配賦 or 上書き） */
  overrideMode?: 'APPORTION' | 'OVERRIDE';
  baseOverride?: number;

  /** 戦略OKR用：メタ */
  track?: StrategyTrack; // evolve/explore
  metricRole?: MetricRole; // leading/lagging/learning
  validation?: ValidationPlan; // exploreならここが重要
  bridgeToLever?: GrowthLever; // types側にある場合はそのまま使う（再定義しない）
  mode?: 'direct' | 'indirect'; // types側にある場合はそのまま使う
};

/* ============================================================
 * 進化/探索：探索バリアント型（最小）
 * ========================================================== */
export type OkrVariantStatus = 'draft' | 'candidate' | 'adopted' | 'rejected';
export type OkrVariantSource = 'ai' | 'human' | 'import';

export type OkrVariant = {
  id: string;
  title: string;
  status: OkrVariantStatus;
  createdAt: number;
  source: OkrVariantSource;

  /** バリアントの意図 */
  track?: StrategyTrack;
  levers?: GrowthLever[];

  /** 既存互換（旧実装のまま残す） */
  notes?: string;
  winPattern?: 'primary' | 'secondary' | 'none';

  /** 中身（構造化KR） */
  okrsV2: KRStructuredX[];

  /** 差分参照 */
  diffFrom?: string;
};

/* ============================================================
 * 共通ユーティリティ
 * ========================================================== */
export const ensureArray = <T,>(v: T[] | undefined): T[] =>
  Array.isArray(v) ? v : [];

/* ============================================================
 * ID生成 & KRStructured生成
 * ========================================================== */
export const genId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

export function mkKRStructured(
  p: Omit<KRStructuredX, 'id'> &
    Partial<
      Pick<
        KRStructuredX,
        | 'id'
        | 'owner'
        | 'due'
        | 'weight'
        | 'elasticity'
        | 'lagMonths'
        | 'startYm'
        | 'notes'
        | 'overrideMode'
        | 'baseOverride'
        | 'track'
        | 'metricRole'
        | 'validation'
        | 'bridgeToLever'
        | 'mode'
      >
    >,
): KRStructuredX {
  return {
    id: p.id ?? genId(),
    kind: p.kind,
    label: p.label,
    target: p.target,
    unit: p.unit,
    scope: p.scope,
    baseKey: p.baseKey,
    owner: p.owner,
    due: p.due,

    // 拡張（optional）
    weight: p.weight ?? 1,
    elasticity: p.elasticity,
    lagMonths: p.lagMonths ?? 0,
    startYm: p.startYm,
    notes: p.notes,
    overrideMode: p.overrideMode ?? 'APPORTION',
    baseOverride: p.baseOverride,

    // 戦略OKRメタ
    track: p.track,
    metricRole: p.metricRole,
    validation: p.validation,
    bridgeToLever: p.bridgeToLever,
    mode: p.mode,
  };
}

/* 既存データの後追い補修：okrsV2/variant.okrsV2 の id 不足を補完
 * + 戦略OKRメタのデフォルト付与（破壊しない範囲で）
 */
export function ensureKrIds(departments: Department[]): Department[] {
  let touched = false;

  const patched = departments.map((d) => {
    const projs = Array.isArray(d.projects)
      ? d.projects.map((p) => {
          // committed
          const committed = Array.isArray(p.okrsV2)
            ? p.okrsV2.map((k) => {
                const kk = k as KRStructuredX;

                // id補完
                if (!kk?.id) {
                  touched = true;
                  return mkKRStructured({
                    ...kk,
                    // 既存値が無い場合だけ、戦略メタの最低限を補う
                    track: kk.track ?? p.track,
                  });
                }

                // メタの補完（非破壊）
                if (!kk.track && p.track) {
                  touched = true;
                  return { ...kk, track: p.track };
                }

                return kk;
              })
            : p.okrsV2;

          // variants
          const variants = Array.isArray(p.okrVariants)
            ? p.okrVariants.map((v) => {
                const nextOkrs = Array.isArray(v.okrsV2)
                  ? v.okrsV2.map((k) => {
                      const kk = k as KRStructuredX;
                      if (!kk?.id) {
                        touched = true;
                        return mkKRStructured({
                          ...kk,
                          track: kk.track ?? v.track ?? p.track,
                        });
                      }
                      if (!kk.track && (v.track ?? p.track)) {
                        touched = true;
                        return { ...kk, track: v.track ?? p.track };
                      }
                      return kk;
                    })
                  : [];
                return { ...v, okrsV2: nextOkrs };
              })
            : p.okrVariants;

          return { ...p, okrsV2: committed, okrVariants: variants };
        })
      : d.projects;

    return { ...d, projects: projs };
  });

  return touched ? patched : departments;
}

/* ============================================================
 * カスケードOKR → 構造化KR たたき台 用ヘルパー
 * ========================================================== */
export type DraftBaseKey =
  | 'acq'
  | 'arpu'
  | 'churn'
  | 'fixed_cost'
  | 'variable_cost'
  | 'personnel_cost'
  | 'invest'
  | 'success_rate'
  | 'synergy'
  | 'revenue';

// 単位の推定
export function guessUnit(text: string): KRUnit {
  if (/[％%]/.test(text)) return '%';
  if (/円|¥/.test(text)) return '¥';
  if (/人/.test(text)) return '人';
  if (/件|社|口座|契約/.test(text)) return '件';
  if (/率|比率/.test(text)) return '比率';
  return '件';
}

// 種類(kind)と baseKey の簡易推定
export function guessKindAndBase(text: string): {
  kind: KRKind;
  baseKey: DraftBaseKey;
} {
  const t = text.toLowerCase();

  if (/新規|獲得|リード|来店|登録/.test(text)) return { kind: 'ACQ', baseKey: 'acq' };
  if (/単価|客単価|arpu/.test(text)) return { kind: 'ARPU', baseKey: 'arpu' };
  if (/解約|離脱|チャーン/.test(text)) return { kind: 'CHURN', baseKey: 'churn' };
  if (/固定費|家賃|減価/.test(text)) return { kind: 'COST_FIXED', baseKey: 'fixed_cost' };
  if (/変動費|原価/.test(text)) return { kind: 'COST_VARIABLE', baseKey: 'variable_cost' };
  if (/人件費|採用|給与|賞与|人員/.test(text)) return { kind: 'PERSONNEL', baseKey: 'personnel_cost' };
  if (/投資|開発|新規事業|r&d|研究開発/i.test(t)) return { kind: 'INVEST', baseKey: 'invest' };
  if (/成功率|成約率|勝率|転換率/.test(text)) return { kind: 'SUCCESS_RATE', baseKey: 'success_rate' };
  if (/シナジー|連携|横串|コラボ/.test(text)) return { kind: 'SYNERGY', baseKey: 'synergy' };
  if (/売上|収益|利益|arr|mrr/i.test(t)) return { kind: 'REVENUE', baseKey: 'revenue' };

  return { kind: 'ACQ', baseKey: 'acq' };
}

/** track推定（最低限）
 * - 探索語彙（PoC/検証/実験/新規等）が強い場合 EXPLORE
 * - それ以外は EVOLVE
 */
export function guessTrack(text: string): StrategyTrack {
  if (/検証|実験|PoC|パイロット|新規|探索|仮説|学習/i.test(text)) return 'EXPLORE';
  return 'EVOLVE';
}

/** metricRole推定（最低限）
 * - 学習語彙 → LEARNING
 * - 活動語彙 → LEADING
 * - 売上/利益/ARRなど結果語彙 → LAGGING
 */
export function guessMetricRole(text: string): MetricRole {
  if (/学習|示唆|インサイト|仮説|検証|理解/i.test(text)) return 'LEARNING';
  if (/訪問|架電|商談|提案|面談|デモ|問い合わせ|登録|リード/i.test(text)) return 'LEADING';
  if (/売上|利益|ARR|MRR|粗利|成約|受注/i.test(text)) return 'LAGGING';
  return 'LEADING';
}

// テキスト1本から構造化KRを組み立てる
export function buildKRFromText(
  text: string,
  ownerHint?: string,
  opts?: {
    scope?: KRScope;
    track?: StrategyTrack;
  },
): KRStructuredX {
  const numMatch = text.match(/-?\d+(\.\d+)?/);
  const target = numMatch ? Number(numMatch[0]) : 0;

  const unit = guessUnit(text);
  const { kind, baseKey } = guessKindAndBase(text);

  const track = opts?.track ?? guessTrack(text);
  const metricRole = guessMetricRole(text);

  return mkKRStructured({
    kind,
    label: text.trim(),
    target,
    unit,
    scope: opts?.scope ?? 'project',
    baseKey: baseKey as unknown as BaseKey,
    owner: ownerHint,
    weight: 1,
    elasticity: undefined,
    lagMonths: 0,
    startYm: undefined,
    notes: undefined,
    overrideMode: 'APPORTION',
    baseOverride: undefined,

    // 戦略OKRメタ
    track,
    metricRole,
    validation:
      track === 'EXPLORE'
        ? {
            status: 'not_started',
            hypothesis: '',
            testMethod: '',
            evidence: '',
            nextAction: '',
          }
        : undefined,
  });
}

/* ============================================================
 * 進化/探索：差分（簡易）
 * ========================================================== */
export type DiffItem =
  | { type: 'added'; label: string }
  | { type: 'removed'; label: string }
  | { type: 'changed'; label: string; fields: string[] };

function normalizeLabel(s: any) {
  return String(s ?? '').trim();
}

export function diffKrSets(committed: KRStructuredX[], candidate: KRStructuredX[]): DiffItem[] {
  const a = ensureArray(committed);
  const b = ensureArray(candidate);

  const mapA = new Map<string, KRStructuredX>();
  const mapB = new Map<string, KRStructuredX>();

  a.forEach((k) => {
    const key = normalizeLabel(k.label);
    if (key) mapA.set(key, k);
  });
  b.forEach((k) => {
    const key = normalizeLabel(k.label);
    if (key) mapB.set(key, k);
  });

  const items: DiffItem[] = [];

  for (const [label] of mapB) {
    if (!mapA.has(label)) items.push({ type: 'added', label });
  }
  for (const [label] of mapA) {
    if (!mapB.has(label)) items.push({ type: 'removed', label });
  }
  for (const [label, ka] of mapA) {
    const kb = mapB.get(label);
    if (!kb) continue;

    const fields: string[] = [];
    if (ka.kind !== kb.kind) fields.push('kind');
    if (Number(ka.target ?? 0) !== Number(kb.target ?? 0)) fields.push('target');
    if ((ka.unit ?? '') !== (kb.unit ?? '')) fields.push('unit');
    if ((ka.scope ?? '') !== (kb.scope ?? '')) fields.push('scope');
    if ((ka.baseKey ?? '') !== (kb.baseKey ?? '')) fields.push('baseKey');
    if ((ka.owner ?? '') !== (kb.owner ?? '')) fields.push('owner');
    if ((ka.due ?? '') !== (kb.due ?? '')) fields.push('due');
    if ((ka.weight ?? 1) !== (kb.weight ?? 1)) fields.push('weight');
    if ((ka.elasticity ?? null) !== (kb.elasticity ?? null)) fields.push('elasticity');
    if ((ka.lagMonths ?? 0) !== (kb.lagMonths ?? 0)) fields.push('lagMonths');
    if ((ka.startYm ?? '') !== (kb.startYm ?? '')) fields.push('startYm');
    if ((ka.overrideMode ?? 'APPORTION') !== (kb.overrideMode ?? 'APPORTION')) fields.push('overrideMode');
    if ((ka.baseOverride ?? null) !== (kb.baseOverride ?? null)) fields.push('baseOverride');
    if ((ka.notes ?? '') !== (kb.notes ?? '')) fields.push('notes');

    // 戦略OKRメタ
    if ((ka.track ?? '') !== (kb.track ?? '')) fields.push('track');
    if ((ka.metricRole ?? '') !== (kb.metricRole ?? '')) fields.push('metricRole');

    const va = ka.validation;
    const vb = kb.validation;
    if (String(va?.status ?? '') !== String(vb?.status ?? '')) fields.push('validation.status');
    if (String(va?.hypothesis ?? '') !== String(vb?.hypothesis ?? '')) fields.push('validation.hypothesis');
    if (String(va?.testMethod ?? '') !== String(vb?.testMethod ?? '')) fields.push('validation.testMethod');
    if (String(va?.evidence ?? '') !== String(vb?.evidence ?? '')) fields.push('validation.evidence');
    if (String(va?.nextAction ?? '') !== String(vb?.nextAction ?? '')) fields.push('validation.nextAction');

    if (fields.length) items.push({ type: 'changed', label, fields });
  }

  // type を union に固定し、order参照を型安全化
  const order: Record<DiffItem['type'], number> = {
    added: 0,
    removed: 1,
    changed: 2,
  };

  items.sort((x, y) => order[x.type] - order[y.type]);
  return items.slice(0, 20);
}
