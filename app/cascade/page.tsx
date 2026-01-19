// /app/cascade/page.tsx（STAGE3 完成版・KPI表記統一＋人的投資セクション対応）
// ※ユーザー提示コードを「削らず」ベースに、/api/generate-cascade の 2レーン（existing/new）を取り込み
//   - 既存機能（タブ/追加/削除/保存/一括生成/部門生成/勝ち筋カタログ/QuestionStepper/KPI簡易編集）を維持
//   - 生成結果が lanes.existing / lanes.new を返す場合、両方をマージして projects に反映（既存UIが壊れない）
//   - さらに「レーン別の表示（参考表示）」を部門カード内に追加（保存モデルは変えず、このページ内で保持）
//
// 重要：types/strategy.ts の Project/Department に lanes フィールドを追加していない前提で、
//       このページ内の ref に保持する方式にしています（store/DBを壊しません）。
//
// ★今回の最適化/修正ポイント（ページ内で完結・DB/Store型は壊さない）
// 1) 再生成のたびにプロジェクトが増殖しないよう「タイトル正規化」による idempotent merge を実装
// 2) new lane が返す expectedImpactYen / probability を OKRに保持（UIで編集しても落ちない）
// 3) 送信payloadにも expectedImpactYen / probability があれば含める（AI側の文脈維持に効く）
// 4) 「今後使わない可能性が高い」未使用のコード/状態は削除（ただし既存機能は維持）

'use client';

import { useEffect, useMemo, useState, useCallback, useRef, memo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import DepartmentQuestionStepper, {
  type DeptAnswerStep,
  type StepNumber,
  type OKR as DeptOKR,
} from '@/components/guide/QuestionStepper.dept';
import { Button } from '@/components/ui/button';
import {
  PlusCircle,
  Save,
  Sparkles,
  Building2,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toProbability } from '@/types/strategy';

import { useAutoSave } from '@/hooks/useAutoSave';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import {
  getStage2ValueDriverKPIs,
  getStage2TargetRanges,
  getStage2WinPatterns,
} from '@/utils/stage2Selectors';

import type {
  Department as BaseDepartment,
  Project as BaseProject,
  OKR as BaseOKR,
  ChapterAnswers as BaseChapterAnswers,
  AnswerStep as BaseAnswerStep,
  HumanInvestment,
  HumanInvestmentCategory,
  HumanInvestmentHorizon,
  SkillRequirements,
} from '@/types/strategy';

// ★ 勝ち筋カタログ＆生成エンジン
import {
  generateProjectsForDepartment,
  type IndustryCode,
  type DepartmentKind as PatternDepartmentKind,
  type GrowthLever,
} from '@/lib/strategyPatterns.catalog';

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === "1";

/* =========================
   型（store拡張互換）
========================= */
// プロジェクトの「仮説メタデータ」
type Lever =
  | 'ACQ'
  | 'ARPU'
  | 'CHURN'
  | 'COST'
  | 'EFFICIENCY'
  | 'FUTURE';

type Horizon = 'short' | 'mid' | 'long';

type Kind = 'growth' | 'cost' | 'efficiency' | 'future';

type Project = BaseProject & {
  hypothesis?: string;
  mainLever?: Lever;
  horizon?: Horizon;
  kind?: Kind;
};

// ★ expectedImpactYen / probability を失わないためにページ内ローカルで拡張
type StoreOKR = BaseOKR & {
  expectedImpactYen?: number;
  probability?: number;
  // 将来、APIが title を添える可能性に備えて保持（落とさない）
  title?: string;
};

type StoreAnswerStep = BaseAnswerStep;
type StoreChapterAnswers = BaseChapterAnswers;

type Department = BaseDepartment & {
  mission?: string;
  strategy?: string;
  missionDraft?: string;
  discussionNotes?: string;
  answers2?: StoreChapterAnswers[];
  finalized?: boolean;
};

/* =========================
   /api/generate-cascade（2レーン互換）
========================= */
type ApiProjectDraft = {
  title?: string;
  hypothesis?: string;
  mainLever?: any;
  horizon?: any;
  kind?: any;

  // 追加フィールドが来ても無害
  reason?: string;
  description?: string;
};

type ApiOKRDraft = {
  objective?: string;
  keyResults?: any[];
  owner?: string;

  // new lane で来る可能性
  expectedImpactYen?: number;
  probability?: number;

  // 追加で来ても無害
  title?: string; // API側が将来 project title を添える可能性に備える
};

type ApiLane = {
  projects?: ApiProjectDraft[];
  okrDraft?: ApiOKRDraft[];
};

type ApiDeptDraft = {
  name?: string;
  missionDraft?: string;

  // 旧形式
  projects?: ApiProjectDraft[];
  okrDraft?: ApiOKRDraft[];

  // 新形式（2レーン）
  lanes?: {
    existing?: ApiLane;
    new?: ApiLane;
  };

  // その他
  needsCollab?: string[];
  stopList?: string[];
  first90Days?: string[];
  riskNotes?: string[];
};

type ApiCascadeResponse = {
  strategy?: { summary?: string };
  departments?: ApiDeptDraft[];
  error?: string;
};

/* =========================
   レバー/時間軸ラベル
========================= */
const LEVER_LABEL: Record<Lever, string> = {
  ACQ: 'ACQ（顧客数）',
  ARPU: 'ARPU（単価）',
  CHURN: 'CHURN（解約/離脱）',
  COST: 'COST（コスト）',
  EFFICIENCY: 'EFFICIENCY（生産性）',
  FUTURE: 'FUTURE（将来の種）',
};

const HORIZON_LABEL: Record<Horizon, string> = {
  short: '短期（〜1年）',
  mid: '中期（1〜3年）',
  long: '長期（3年以上）',
};

const KIND_LABEL: Record<Kind, string> = {
  growth: '成長（売上/LTV）',
  cost: 'コスト削減',
  efficiency: '業務効率',
  future: '将来への投資',
};

const LEVER_VALUES: Lever[] = ['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE'];
const HORIZON_VALUES: Horizon[] = ['short', 'mid', 'long'];
const KIND_VALUES: Kind[] = ['growth', 'cost', 'efficiency', 'future'];

const normalizeLever = (v: any): Lever | undefined =>
  LEVER_VALUES.includes(v as Lever) ? (v as Lever) : undefined;

const normalizeHorizon = (v: any): Horizon | undefined =>
  HORIZON_VALUES.includes(v as Horizon) ? (v as Horizon) : undefined;

const normalizeKind = (v: any): Kind | undefined =>
  KIND_VALUES.includes(v as Kind) ? (v as Kind) : undefined;

/* =========================
   ユーティリティ
========================= */
const escapeHtml = (s: string) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (m) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[m]!),
  );

const nl2brSafe = (s?: string) => (s ? escapeHtml(s).replace(/\r?\n/g, '<br>') : '');

const safeJsonFromText = <T = any>(raw: string): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/m);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        // ignore
      }
    }
  }
  return null;
};

const jsonEq = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ★ タイトル正規化（重複/増殖防止）
const normalizeTitleKey = (t: string) =>
  (t ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/* ストーリー変換 */
const isNonEmptyStoryPayload = (v: any): boolean => {
  if (!v) return false;
  if (Array.isArray(v)) return v.some((c) => (c.title ?? '').trim() || (c.body ?? '').trim());
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
};

function getStory(raw: any) {
  if (Array.isArray(raw) && raw.length) {
    const chapters = raw
      .map((c: any, i: number) => ({
        title: c?.title?.trim() || `Chapter ${i + 1}`,
        body: c?.body ?? '',
      }))
      .filter((c) => c.title.trim() || c.body.trim());
    const text = chapters.map((c, i) => `【第${i + 1}章】${c.title}\n${c.body}`).join('\n\n');
    return { text, chapters };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    const lines = text.split(/\r?\n/);
    const chunkSize = Math.max(1, Math.ceil(lines.length / 4));
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize) chunks.push(lines.slice(i, i + chunkSize).join('\n'));
    const chapters = chunks.map((body, i) => ({ title: `Chapter ${i + 1}`, body }));
    return { text, chapters };
  }
  return { text: '', chapters: [] };
}

/* 変換 */
const toDeptAnswers = (steps?: StoreAnswerStep[]): DeptAnswerStep[] =>
  (steps ?? []).map((s) => ({
    stepNumber: Number(s.stepNumber) as StepNumber,
    question: s.question ?? '',
    reason: s.reason ?? '',
    answer: s.answer ?? '',
    createdAt: '1970-01-01T00:00:00Z',
  }));

const toStoreSteps = (answers: DeptAnswerStep[]): StoreAnswerStep[] =>
  answers.map((a) => ({
    stepNumber: a.stepNumber,
    question: a.question,
    reason: a.reason,
    answer: a.answer,
  }));

const toStoreOKR = (o: DeptOKR): StoreOKR => ({
  objective: (o.objective ?? '').trim(),
  keyResults: o.keyResults?.filter(Boolean) ?? [],
  owner: o.owner?.trim() || undefined,
});

/* スナップショット＆ハッシュ（Dirty判定） */
function makeSaveSnapshot(s: any) {
  const snap: any = {
    strategyId: s?.strategyId ?? undefined,
    story: Array.isArray(s?.story) ? s.story : [],
    finalStory: Array.isArray(s?.finalStory) ? s.finalStory : [],
    answers2: Array.isArray(s?.answers2) ? s.answers2 : [],
    departments: Array.isArray(s?.departments) ? s.departments : [],
    companyName: s?.companyName,
    mission: s?.mission,
    vision: s?.vision,
    value: s?.value,
    thought: s?.thought,
  };
  if (Array.isArray(s?.csvFinanceData)) snap.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s?.financeSummary)) snap.financeSummary = s.financeSummary;
  if (typeof s?.businessPortfolio !== 'undefined') snap.businessPortfolio = s.businessPortfolio;
  if (typeof s?.simulationResult !== 'undefined') snap.simulationResult = s.simulationResult;
  return snap;
}

function hashSnapshot(obj: any) {
  const s = JSON.stringify(obj ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* =========================
   OKRの品質補正（プレースホルダ除去／重複KRの回避）
========================= */

// 典型的な「ダメObjective」検知
const isBadObjective = (s: string) => {
  const t = (s ?? '').trim();
  if (!t) return true;
  return (
    /数字禁止/.test(t) ||
    /勝ち筋の実装/.test(t) ||
    /構造変化/.test(t) ||
    /placeholder/i.test(t) ||
    /^目的[:：]\s*$/i.test(t)
  );
};

const normalizeKRText = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();

const areAllKRSame = (krs: string[]) => {
  const xs = (krs ?? []).map(normalizeKRText).filter(Boolean);
  if (xs.length <= 1) return false;
  return new Set(xs).size === 1;
};

const buildObjectiveFromProject = (p: {
  title: string;
  kind?: Kind;
  lever?: Lever;
  horizon?: Horizon;
}) => {
  const title = (p.title ?? '').trim() || 'このプロジェクト';
  const kind = p.kind ? KIND_LABEL[p.kind] : '';
  const lever = p.lever ? LEVER_LABEL[p.lever] : '';
  const horizon = p.horizon ? HORIZON_LABEL[p.horizon] : '';
  const meta = [kind, lever, horizon].filter(Boolean).join(' / ');

  if (meta) {
    return `「${title}」により、狙う成果（${meta}）が再現性をもって出る状態を確立する`;
  }
  return `「${title}」により、狙う成果が再現性をもって出る状態を確立する`;
};

const buildDistinctKRs = (p: { title: string; lever?: Lever; kind?: Kind; horizon?: Horizon }) => {
  const title = (p.title ?? '').trim() || '当該プロジェクト';
  const lever = p.lever;

  const common = [
    `「${title}」の成功条件（前提・制約・対象範囲）を合意し、実行設計（体制/プロセス/意思決定）を確定する`,
    `「${title}」で追う主要指標（先行指標/遅行指標）と計測手段（データ源/頻度）を確立する`,
    `阻害要因（ボトルネック）を特定し、改善ループ（週次/隔週）を運用開始する`,
  ];

  const byLever: Record<Lever, string[]> = {
    ACQ: [
      `主要ターゲットに対する獲得ファネル（接点→商談→受注）の再現性を作る（定義/導線/責任分界を明確化）`,
      `新規獲得の勝ちパターン（提案骨子/訴求/チャネル）を標準化し、チームに展開する`,
      `獲得ボトルネック（リード質/歩留まり/提案力）を特定し、打ち手を実装する`,
    ],
    ARPU: [
      `価値提供メニュー（アップセル/クロスセル）の設計を確定し、提案可能な状態にする`,
      `価格・条件・提供範囲の意思決定基準を整備し、提案のブレをなくす`,
      `高付加価値顧客セグメントの定義と優先順位を確定し、営業/CSの運用に落とす`,
    ],
    CHURN: [
      `解約/離脱の主要要因を構造化し、予兆指標と介入プロセスを確立する`,
      `オンボーディング/定着の標準プロセスを整備し、品質を均一化する`,
      `重点顧客の継続価値を上げる施策（利用深度/活用支援）を運用開始する`,
    ],
    COST: [
      `コスト構造（固定/変動/原価要因）を可視化し、削減余地の優先順位を確定する`,
      `ムダ工程/重複業務を特定し、廃止・統合・自動化の実装計画を確定する`,
      `外部支出（購買/委託/保守）の見直し方針を定め、交渉/切替を開始する`,
    ],
    EFFICIENCY: [
      `業務の標準手順と責任分界を明確化し、属人性の高い工程を縮小する`,
      `主要業務のリードタイム/品質のボトルネックを特定し、改善サイクルを回す`,
      `データ/ツール/連携の欠損を埋め、現場が迷わず判断できる状態を作る`,
    ],
    FUTURE: [
      `探索テーマの仮説（誰の何の課題をどう解くか）を明確化し、検証計画を確定する`,
      `検証（PoC/試験導入）の成功条件と判断基準を定め、学習を回す`,
      `将来の事業化に向けた要件（収益モデル/提供体制/リスク）を整理し、次アクションに落とす`,
    ],
  };

  const tailored = lever ? byLever[lever] : [];
  const pool = [...tailored, ...common];

  const picked: string[] = [];
  const used = new Set<string>();
  for (const s of pool) {
    const t = normalizeKRText(s);
    if (!t || used.has(t)) continue;
    used.add(t);
    picked.push(s);
    if (picked.length >= 3) break;
  }
  return picked;
};

function sanitizeOkrsForProject(p: Project, okrs: StoreOKR[]): StoreOKR[] {
  const list = Array.isArray(okrs) ? okrs : [];
  if (!list.length) return [];

  // ★ extra fields を落とさないため、コピーは spread のみ（ここが重要）
  const first = { ...(list[0] as StoreOKR) };

  const objective = (first.objective ?? '').trim();
  const krsRaw = (first.keyResults ?? [])
    .map((x: any) => String(x ?? ''))
    .map((x) => x.trim())
    .filter(Boolean);

  if (isBadObjective(objective)) {
    first.objective = buildObjectiveFromProject({
      title: p.title ?? '',
      kind: p.kind,
      lever: p.mainLever,
      horizon: p.horizon,
    });
  }

  const krs = krsRaw;
  if (!krs.length || areAllKRSame(krs)) {
    first.keyResults = buildDistinctKRs({
      title: p.title ?? '',
      lever: p.mainLever,
      kind: p.kind,
      horizon: p.horizon,
    });
  } else {
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const kr of krs) {
      const t = normalizeKRText(kr);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      uniq.push(kr);
    }
    first.keyResults = uniq;
  }

  return [first, ...list.slice(1)];
}

/* =========================
   勝ち筋系ヘルパー
========================= */

// 業種文字列 → IndustryCode
const detectIndustryCode = (raw: string | undefined): IndustryCode => {
  const t = (raw ?? '').toLowerCase();
  if (t.includes('saas') || t.includes('software') || t.includes('it')) return 'SAAS';
  if (t.includes('製造') || t.includes('メーカー')) return 'MANUFACTURING';
  if (t.includes('小売') || t.includes('retail')) return 'RETAIL';
  if (t.includes('金融') || t.includes('bank') || t.includes('証券')) return 'FINANCE';
  if (t.includes('サービス')) return 'SERVICE';
  return 'OTHER';
};

// 部門名 → DepartmentKind
const detectDepartmentKind = (name: string): PatternDepartmentKind => {
  const n = name.toLowerCase();
  if (/営業|sales/.test(name)) return 'SALES';
  if (/マーケ|市場|marketing|宣伝|広報/.test(name)) return 'MARKETING';
  if (/カスタマー|cs|サクセス|サポート/.test(name)) return 'CUSTOMER_SUCCESS';
  if (/人事|hr/.test(name)) return 'HR';
  if (/総務|コーポ|管理本部|管理部/.test(name)) return 'GENERAL_AFFAIRS';
  if (/生産|製造|工場/.test(name)) return 'PRODUCTION';
  if (/経理|財務|アカウンティング/.test(name)) return 'FINANCE_DEPT';
  if (/情報システム|情シス|it|システム/.test(name)) return 'IT';
  if (/経営企画|企画|戦略|社長室/.test(name)) return 'CORPORATE';
  if (n.includes('sales')) return 'SALES';
  if (n.includes('marketing')) return 'MARKETING';
  if (n.includes('customer success')) return 'CUSTOMER_SUCCESS';
  if (n.includes('hr') || n.includes('human resource')) return 'HR';
  if (n.includes('corporate') || n.includes('strategy')) return 'CORPORATE';
  return 'OTHER';
};

// ストーリー＆ミッション → GrowthLever優先度（最大2つ）
const detectLeverPriority = (mission: string, story: string, dept: string): GrowthLever[] => {
  const text = `${mission}\n${story}\n${dept}`.toLowerCase();
  const result: GrowthLever[] = [];
  const add = (l: GrowthLever) => {
    if (!result.includes(l)) result.push(l);
  };

  if (/(新規|開拓|リード|商談|見込み|獲得|アポイント)/.test(text)) add('ACQ');
  if (/(単価|アップセル|クロスセル|客単価|l tv|ltv|高付加価値)/i.test(text)) add('ARPU');
  if (/(解約|離脱|継続|維持|チャーン|churn|ロイヤルティ|ロイヤリティ)/i.test(text)) add('CHURN');
  if (/(コスト|費用|原価|削減|効率|生産性|固定費|変動費)/.test(text)) add('COST');
  if (/(投資|新規事業|研究開発|r&d|イノベーション|将来|未来|種まき)/i.test(text)) add('INVEST');
  if (/(連携|横串|シナジー|コラボ|横断)/.test(text)) add('SYNERGY');

  if (result.length === 0) {
    const dl = dept.toLowerCase();
    if (/(営業|sales)/.test(dl)) {
      add('ACQ');
      add('ARPU');
    } else if (/(人事|hr)/.test(dl)) {
      add('ACQ');
      add('SYNERGY');
    } else if (/(総務|コーポ|管理|finance|経理|財務)/i.test(dept)) {
      add('COST');
      add('SYNERGY');
    } else if (/(生産|製造|工場)/.test(dept)) {
      add('COST');
      add('SYNERGY');
    } else {
      add('ACQ');
      add('COST');
    }
  }

  return result.slice(0, 2);
};

// GrowthLever → 画面側Leverへのマッピング
const mapGrowthLeverToLever = (lever: GrowthLever): Lever | undefined => {
  switch (lever) {
    case 'ACQ':
    case 'ARPU':
    case 'CHURN':
    case 'COST':
      return lever;
    case 'INVEST':
      return 'FUTURE';
    case 'SYNERGY':
      return 'EFFICIENCY';
    default:
      return undefined;
  }
};

// GrowthLever → Kind推定
const mapLeverToKind = (lever: Lever | undefined): Kind | undefined => {
  if (!lever) return undefined;
  if (lever === 'COST') return 'cost';
  if (lever === 'EFFICIENCY') return 'efficiency';
  if (lever === 'FUTURE') return 'future';
  return 'growth';
};

/* =========================
   2レーンのマージ（storeは壊さず projects に統合）
   ★修正点：
   - OKRを「プロジェクト単位に割り当てる」
   - タイトル正規化で増殖を止める
   - expectedImpactYen/probability を保持
========================= */

function toStoreOkrsFromDrafts(okrDraft: ApiOKRDraft[] | undefined): StoreOKR[] {
  const list = Array.isArray(okrDraft) ? okrDraft : [];
  return list
    .map((o) => {
      const objective = (o?.objective ?? '').toString();
      const keyResults = Array.isArray(o?.keyResults) ? o.keyResults.map((x) => String(x ?? '')) : [];
      const owner = (o?.owner ?? '').toString();

      const out: StoreOKR = {
        objective: objective.trim(),
        keyResults: keyResults.filter((x) => String(x).trim()),
        owner: owner.trim() || undefined,
      };

      // ★ new lane の追加フィールドを保持
      if (typeof o?.expectedImpactYen === 'number') out.expectedImpactYen = o.expectedImpactYen;

      // ★ここが修正点：number -> Probability
if (typeof o?.probability === 'number') {
  // 0..1 前提（%の可能性があるなら normalized を使う）
  out.probability = toProbability(o.probability).value;
}


      if (typeof o?.title === 'string' && o.title.trim()) out.title = o.title.trim();

      return out;
    })
    .filter((o) => (o.objective ?? '').trim() || (o.keyResults ?? []).some((k) => String(k).trim()));
}

function pickOkrsForProject(okrsAll: StoreOKR[], pd: ApiProjectDraft, index: number): StoreOKR[] {
  if (!okrsAll.length) return [];

  // 1) title が付与されている将来ケース（title一致）
  const title = (pd?.title ?? '').trim();
  if (title) {
    const key = normalizeTitleKey(title);
    const byTitle = okrsAll.find((o: any) => normalizeTitleKey(String((o as any)?.title ?? '')) === key);
    if (byTitle) return [byTitle];
  }

  // 2) index 対応
  if (okrsAll[index]) return [okrsAll[index]];

  // 3) fallback：先頭
  return okrsAll[0] ? [okrsAll[0]] : [];
}

// スキルリストが「未設定」かどうかを判定（空配列、空文字のみは未設定扱い）
function isSkillListEmpty(skills?: string[]): boolean {
  if (!skills || skills.length === 0) return true;
  return skills.every((s) => !String(s).trim());
}

// デフォルトの人的投資施策を生成
function createDefaultHumanInvestments(): any[] {
  return [
    {
      title: 'OJT・実践的トレーニング',
      category: 'TRAINING_OJT',
      owner: '未定',
      horizon: 'SHORT',
    },
    {
      title: 'ツール・プロセス標準化',
      category: 'TOOLS_PROCESS',
      owner: '未定',
      horizon: 'SHORT',
    },
  ];
}

function normalizeProjectDraft(pd: ApiProjectDraft, okrsForThisProject: StoreOKR[]): Project | null {
  const title = (pd?.title ?? '').trim();
  if (!title) return null;

  const hypothesis =
    typeof pd?.hypothesis === 'string'
      ? pd.hypothesis.trim()
      : typeof pd?.description === 'string'
        ? pd.description.trim()
        : undefined;

  const p: Project = {
    title,
    hypothesis,
    mainLever: normalizeLever(pd?.mainLever),
    horizon: normalizeHorizon(pd?.horizon),
    kind: normalizeKind(pd?.kind),
    okrs: okrsForThisProject,
  } as Project;

  // skillRequirements を API レスポンスから取り込む
  const pdSkills = (pd as any)?.skillRequirements;
  if (pdSkills) {
    (p as any).skillRequirements = pdSkills;
  }

  // humanInvestments を API レスポンスから取り込む
  const pdInvestments = (pd as any)?.humanInvestments;
  if (pdInvestments) {
    (p as any).humanInvestments = pdInvestments;
  }

  // ★空の場合はデフォルト値を補完（未設定を防ぐ）
  const pSkills = (p as any).skillRequirements;
  if (!pSkills || isSkillListEmpty(pSkills?.executionSkills)) {
    (p as any).skillRequirements = {
      roleSkills: pSkills?.roleSkills ?? [],
      executionSkills: ['PM', '標準化', 'データ活用'],
    };
  }

  const pInvestments = (p as any).humanInvestments;
  if (!pInvestments || pInvestments.length === 0) {
    (p as any).humanInvestments = createDefaultHumanInvestments();
  }

  // ★OKR品質補正（プレースホルダ除去/重複KR回避）
  p.okrs = sanitizeOkrsForProject(p, (p.okrs ?? []) as StoreOKR[]);

  return p;
}

function mergeProjectInto(projects: Project[], incoming: Project): Project[] {
  const inKey = normalizeTitleKey(incoming.title ?? '');
  if (!inKey) return projects;

  const existIdx = projects.findIndex((p) => normalizeTitleKey(p.title ?? '') === inKey);
  if (existIdx < 0) return [...projects, incoming];

  const existing = { ...(projects[existIdx] as Project) };
  const existingOkrs: StoreOKR[] = [...(((existing.okrs ?? []) as StoreOKR[]) ?? [])];

  for (const o of ((incoming.okrs ?? []) as StoreOKR[])) {
    if (!existingOkrs.some((eo) => jsonEq(eo, o))) {
      existingOkrs.push(o);
    }
  }

  const merged: Project = {
    ...existing,
    okrs: sanitizeOkrsForProject(existing, existingOkrs),
    hypothesis: incoming.hypothesis || existing.hypothesis,
    mainLever: incoming.mainLever || existing.mainLever,
    horizon: incoming.horizon || existing.horizon,
    kind: incoming.kind || existing.kind,
  };

  // skillRequirements: 空は「未設定」として補完対象
  const existingSkills = (existing as any)?.skillRequirements;
  const incomingSkills = (incoming as any)?.skillRequirements;

  const existingExecSkills = existingSkills?.executionSkills;
  const incomingExecSkills = incomingSkills?.executionSkills;
  const existingRoleSkills = existingSkills?.roleSkills;
  const incomingRoleSkills = incomingSkills?.roleSkills;

  // executionSkills: existing が未設定の場合は補完
  let finalExecSkills: string[];
  if (isSkillListEmpty(existingExecSkills)) {
    // existing が空 → incoming を使うか、それも空ならデフォルト
    if (!isSkillListEmpty(incomingExecSkills)) {
      finalExecSkills = incomingExecSkills;
    } else {
      finalExecSkills = ['PM', '標準化', 'データ活用'];
    }
  } else {
    // existing に有効な値がある → 保持
    finalExecSkills = existingExecSkills;
  }

  // roleSkills: existing があれば保持、無ければ incoming（無ければ[]）
  let finalRoleSkills: string[];
  if (!isSkillListEmpty(existingRoleSkills)) {
    finalRoleSkills = existingRoleSkills;
  } else if (!isSkillListEmpty(incomingRoleSkills)) {
    finalRoleSkills = incomingRoleSkills;
  } else {
    finalRoleSkills = [];
  }

  (merged as any).skillRequirements = {
    executionSkills: finalExecSkills,
    roleSkills: finalRoleSkills,
  };

  // humanInvestments: existing が未設定の場合は補完
  const existingInvestments = (existing as any)?.humanInvestments;
  const incomingInvestments = (incoming as any)?.humanInvestments;

  if (!existingInvestments || existingInvestments.length === 0) {
    // existing が空 → incoming を使うか、それも空ならデフォルト
    if (incomingInvestments && incomingInvestments.length > 0) {
      (merged as any).humanInvestments = incomingInvestments;
    } else {
      (merged as any).humanInvestments = createDefaultHumanInvestments();
    }
  } else {
    // existing に有効な値がある → 保持
    (merged as any).humanInvestments = existingInvestments;
  }

  const next = [...projects];
  next[existIdx] = merged;
  return next;
}

function applyLaneToProjects(base: Project[], lane?: ApiLane): Project[] {
  const projectsDraft: ApiProjectDraft[] = Array.isArray(lane?.projects) ? lane!.projects! : [];
  const okrsAll: StoreOKR[] = toStoreOkrsFromDrafts(lane?.okrDraft);

  let projects = base;
  if (!projectsDraft.length) return projects;

  for (let i = 0; i < projectsDraft.length; i++) {
    const pd = projectsDraft[i];
    const okrsForThis = pickOkrsForProject(okrsAll, pd, i);
    const p = normalizeProjectDraft(pd, okrsForThis);
    if (!p) continue;
    projects = mergeProjectInto(projects, p);
  }
  return projects;
}

function applyDeptDraftToProjects(existingProjects: Project[], deptDraft: ApiDeptDraft): Project[] {
  let projects: Project[] = [...existingProjects];

  // 1) 旧形式：rd.projects / rd.okrDraft（index対応）
  if (Array.isArray(deptDraft.projects) && deptDraft.projects.length) {
    const legacyLane: ApiLane = {
      projects: deptDraft.projects,
      okrDraft: Array.isArray(deptDraft.okrDraft) ? deptDraft.okrDraft : [],
    };
    projects = applyLaneToProjects(projects, legacyLane);
  }

  // 2) 既存進化レーン
  projects = applyLaneToProjects(projects, deptDraft?.lanes?.existing);

  // 3) 新規探索レーン
  projects = applyLaneToProjects(projects, deptDraft?.lanes?.new);

  return projects;
}

/* =========================
   ビジュアルカード（部門戦略の全体像をシンプル表示）
========================= */
const VisualCard = memo(function VisualCard({ d }: { d: Department }) {
  const mission = (d.strategy ?? d.mission ?? '').trim();
  const projects = (d.projects ?? []) as Project[];

  const shortSummary = mission.length > 32 ? mission.slice(0, 32) + '…' : mission;

  return (
    <div className="p-6 rounded-3xl border bg-white/70 backdrop-blur-sm shadow-sm">
      <div className="flex justify-between items-start mb-3 gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2 text-zinc-900">
            <Building2 className="w-4 h-4" />
            {d.name}
          </h3>
          {mission && <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{shortSummary}</p>}
        </div>
        {d.finalized && (
          <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>
        )}
      </div>

      {mission && (
        <div className="mb-4">
          <p className="text-sm text-zinc-800 whitespace-pre-wrap">{mission}</p>
        </div>
      )}

      {projects.length > 0 ? (
        <div>
          <div className="text-xs font-semibold text-zinc-500 mb-1">主なプロジェクトと目標</div>
          <ul className="space-y-3">
            {projects.map((p, i) => {
              const okr = p.okrs?.[0] as StoreOKR | undefined;
              const krs = okr?.keyResults?.filter(Boolean) ?? [];
              return (
                <li key={i} className="rounded-2xl border bg-white/80 px-3 py-2">
                  <div className="text-sm font-medium text-zinc-900">• {p.title || '無題のプロジェクト'}</div>

                  {(p.hypothesis || p.mainLever || p.horizon || p.kind) && (
                    <div className="mt-1">
                      {p.hypothesis && (
                        <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">仮説：{p.hypothesis}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                        {p.kind && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                            {KIND_LABEL[p.kind]}
                          </span>
                        )}
                        {p.mainLever && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                            {LEVER_LABEL[p.mainLever]}
                          </span>
                        )}
                        {p.horizon && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                            {HORIZON_LABEL[p.horizon]}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {okr?.objective && <div className="mt-2 text-xs text-zinc-700">目標：{okr.objective}</div>}
                  {krs.length > 0 && (
                    <ul className="mt-1 pl-4 space-y-1 list-disc text-xs text-zinc-700">
                      {krs.slice(0, 3).map((kr, idx) => (
                        <li key={idx}>{String(kr)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          まだプロジェクトが設定されていません。「編集」タブから追加してください。
        </p>
      )}
    </div>
  );
});

/* =========================
   メイン
========================= */
export default function CascadePage() {
  const s = useStrategyStore() as any;

  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
    refetchFromServer,
    setHydrated,
    boot,
    saveStrategyData: saveNow,
    lastServerSnapshot,
    setDepartments: setDepartmentsInStore,
  } = useStrategyStore();

  const access = useAccess();

  /**
   * 重要：useAccess の実装差分に耐えるため
   * - canEditCompany が関数/boolean どちらでも動く
   * - canEditDepartment が関数/boolean どちらでも動く
   */
  const canEditCompany = useMemo(() => {
    const v = (access as any)?.canEditCompany;
    try {
      return typeof v === 'function' ? !!v.call(access) : !!v;
    } catch {
      return false;
    }
  }, [access]);

  const canEditDept = useCallback(() => {
    const v = (access as any)?.canEditDepartment;
    try {
      return typeof v === 'function' ? !!v.call(access) : !!v;
    } catch {
      return false;
    }
  }, [access]);

  const accessCompanyId: string | undefined = useMemo(
    () => ((access as any)?.companyId ?? (s?.companyId as string | undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(access as any)?.companyId, s?.companyId],
  );

  const industry: string = (s?.industry as string) || (s?.company?.industry as string) || '';
  // ★STAGE2構造化データ取得（セレクタ経由で一本化）
  const valueDriverKPIs = getStage2ValueDriverKPIs(s);
  const targetRanges = getStage2TargetRanges(s);
  const { primary: winPatternPrimary, secondary: winPatternSecondary } = getStage2WinPatterns(s);
  const businessSegments = (s?.businessSegments as any[]) ?? [];

  /* ---- 初回ログだけ ---- */
  useEffect(() => {
    if (DEBUG) console.log('[cascade] mount', { hydrated, scopeCompanyId, accessCompanyId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== 会社スコープ確立（StrictMode耐性）===== */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (lastAppliedCompanyRef.current === accessCompanyId && scopeCompanyId === accessCompanyId) return;

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
    } else if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  /* ===== 初期ロード ===== */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId) return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      const currentSnap = makeSaveSnapshot(useStrategyStore.getState());
      const currentHash = hashSnapshot(currentSnap);
      const isDirty = !!(lastServerSnapshot && lastServerSnapshot !== currentHash);

      const timer = setTimeout(() => !cancelled && setHydrated?.(true), 7000);
      try {
        if (!isDirty) {
          if (DEBUG) console.log('[cascade] 📥 loadAndHydrate 前', { accessCompanyId, isDirty });
          await loadAndHydrate(accessCompanyId);
          if (DEBUG) console.log('[cascade] ✅ loadAndHydrate 後');
          try {
            await refetchFromServer?.();
          } catch {
            // ignore
          }
          setHydrated?.(true);
        } else {
          if (DEBUG) console.log('[cascade] ⏭️ isDirty のためスキップ');
          setHydrated?.(true);
        }
        loadGuardRef.current = accessCompanyId;
      } catch (err) {
        // 🐛 FIX: loadAndHydrate may throw if refetch fails
        // Still need to mark hydrated=true to exit loading state
        const errObj = err as any;
        console.error('[cascade] ❌ loadAndHydrate error:', {
          message: errObj?.message || String(err),
          code: errObj?.code,
        });
        console.warn('[cascade] hydrated=true を強制設定（エラー時UI表示対応）');
        setHydrated?.(true);
        loadGuardRef.current = accessCompanyId;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    accessCompanyId,
    hydrated,
    scopeCompanyId,
    refetchFromServer,
    setHydrated,
    lastServerSnapshot,
    setCompanyScope,
  ]);

  /* ===== ハイドレーション・ウォッチドッグ ===== */
  const hydrateStartRef = useRef<number | null>(null);
  useEffect(() => {
    const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
    const nowHydrating = (boot?.isHydrating && !hydrated) || mismatch;

    if (nowHydrating) {
      if (hydrateStartRef.current == null) hydrateStartRef.current = Date.now();
    } else {
      hydrateStartRef.current = null;
    }

    const id = setInterval(() => {
      if (hydrateStartRef.current != null && Date.now() - hydrateStartRef.current > 5000) {
        setHydrated?.(true);
        hydrateStartRef.current = null;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [boot?.isHydrating, hydrated, accessCompanyId, scopeCompanyId, setHydrated]);

  /* ===== departments（store を唯一のソースに） ===== */
  const departments = useStrategyStore(
    (st) => ((st.departments as Department[] | undefined) ?? []) as Department[],
  );

  /* ===== STAGE1事業部名→初期部門展開（One-time import）===== */
  const hasInitializedFromStage1Ref = useRef(false);
  useEffect(() => {
    if (!hydrated || hasInitializedFromStage1Ref.current) return;
    if (departments.length > 0) {
      hasInitializedFromStage1Ref.current = true;
      return;
    }
    if (businessSegments.length === 0) return;

    // departments が空で、businessSegments があれば初期展開
    const initialDepts: Department[] = businessSegments.map((seg: any) => ({
      name: seg?.name || '無題の部門',
      mission: seg?.scope || '',
      strategy: seg?.scope || '',
      missionDraft: '',
      discussionNotes: '',
      projects: [],
      answers2: [{ chapterIndex: 0, chapterTitle: seg?.name || '無題の部門', steps: [] }],
      finalized: false,
      source: 'stage1' as const,
    }));

    setDepartmentsInStore?.(initialDepts);
    hasInitializedFromStage1Ref.current = true;
    if (DEBUG) console.log('[cascade] STAGE1事業部から初期部門を生成しました:', initialDepts.length);
  }, [hydrated, departments.length, businessSegments, setDepartmentsInStore]);

  // hydrated 後のみオートセーブ対象
  useAutoSave(hydrated && !boot?.isHydrating ? [accessCompanyId, departments] : []);

  const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
  const isHydrating = (Boolean(boot?.isHydrating) && !hydrated) || mismatch || !hydrated;

  const rawStory = useMemo(() => {
    if (isNonEmptyStoryPayload(s?.finalStory)) return s.finalStory;
    if (isNonEmptyStoryPayload(s?.story)) return s.story;
    if (isNonEmptyStoryPayload(s?.strategyStory)) return s.strategyStory;
    return '';
  }, [s?.finalStory, s?.story, s?.strategyStory]);

  const { text: storyText, chapters: storyChapters } = useMemo(() => getStory(rawStory), [rawStory]);

  const [notice, setNotice] = useState('');
  const [isCascadeGenerating, setIsCascadeGenerating] = useState(false);

  /* ===== レーン表示用の一時キャッシュ（store/DBは変更しない） ===== */
  const laneCacheRef = useRef<Record<string, { existing?: ApiLane; new?: ApiLane }>>({});
  const [showLaneDetail, setShowLaneDetail] = useState<Record<string, boolean>>({});

  /* ===== 部門配列更新ヘルパー ===== */
  const pushToStore = useCallback(
    (next: Department[] | ((prev: Department[]) => Department[])) => {
      const prev = ((useStrategyStore.getState().departments as Department[] | undefined) ?? []) as Department[];
      const resolved = typeof next === 'function' ? (next as (p: Department[]) => Department[])(prev) : next;
      if (!jsonEq(prev, resolved)) {
        setDepartmentsInStore?.(resolved);
      }
    },
    [setDepartmentsInStore],
  );

  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');
  const [showForm, setShowForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [inlineEdit, setInlineEdit] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, any>>({});

  /* ===== 部門の増減に応じてインライン編集状態をリセット ===== */
  useEffect(() => {
    setInlineEdit({});
  }, [departments.length]);

  /* ===== その場保存（部門ミッション） ===== */
  const saveInlineMission = async (index: number) => {
    let changed = false;

    pushToStore((prev) => {
      const current = [...prev];
      const d = current[index];
      if (!d) return prev;

      const draft = (inlineEdit[index] ?? d.strategy ?? d.mission ?? '').toString();
      if ((d.mission ?? '') === draft && (d.strategy ?? '') === draft && (d.missionDraft ?? '') === draft) {
        return prev;
      }

      const updated: Department = {
        ...d,
        mission: draft,
        strategy: draft,
        missionDraft: draft,
      };
      current[index] = updated;
      changed = true;
      return current;
    });

    if (!changed) {
      setNotice('（変更はありません）');
      return;
    }

    setNotice('✅ 保存しました');

    if (saveNow) {
      try {
        await saveNow();
        setNotice('✅ 保存しました（サーバーにも反映済み）');
      } catch {
        setNotice('⚠️ ローカル保存は完了しましたが、サーバー保存に失敗しました');
      }
    }
  };

  const requireStoryOrWarn = (): string | null => {
    if (!storyText.trim()) {
      setNotice('⚠️ 経営ストーリーを先に作成してください（STAGE 2 の完了が必要です）');
      return null;
    }
    return storyText;
  };

  /* ===== 離脱/非表示時の即時保存 ===== */
  useEffect(() => {
    const flush = async () => {
      const st = useStrategyStore.getState();
      if (st.boot?.isHydrating || !st.boot?.isHydrated) return;
      const snap = makeSaveSnapshot(st);
      const hash = hashSnapshot(snap);
      if (st.lastServerSnapshot && st.lastServerSnapshot === hash) return;
      try {
        await saveNow?.();
      } catch {
        // ignore
      }
    };
    const onBeforeUnload = () => void flush();
    const onPageHide = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saveNow]);

  /* ===== プロジェクト削除 ===== */
  const handleDeleteProject = async (deptIndex: number, projectIndex: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト削除の権限がありません');

    const targetProject = (dept.projects as Project[] | undefined)?.[projectIndex];
    if (!targetProject) return;

    const ok = window.confirm(`プロジェクト「${targetProject.title || '無題'}」を削除しますか？`);
    if (!ok) return;

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;
      const projects = [...((d.projects as Project[] | undefined) ?? [])];
      projects.splice(projectIndex, 1);
      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`🗑 プロジェクト「${targetProject.title || '無題'}」を削除しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(`🗑 プロジェクト「${targetProject.title || '無題'}」を削除しました（サーバーにも反映済み）`);
      } catch {
        setNotice(`⚠️ プロジェクト削除をサーバーに保存できませんでした（画面上は削除済み）`);
      }
    }
  };

  /* ===== プロジェクト追加（手入力／OKR画面で詳細編集も可能） ===== */
  const handleAddProject = async (deptIndex: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト追加の権限がありません');

    const existingProjects = (dept.projects as Project[] | undefined) ?? [];
    const baseTitle = '新しいプロジェクト';
    const existing = new Set(existingProjects.map((p) => normalizeTitleKey(p.title || '')));
    let title = baseTitle;
    let n = 2;
    while (existing.has(normalizeTitleKey(title))) {
      title = `${baseTitle} ${n}`;
      n += 1;
    }

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;

      const projects: Project[] = [
        ...((d.projects as Project[] | undefined) ?? []),
        {
          title,
          okrs: [] as StoreOKR[],
          skillRequirements: {
            roleSkills: [],
            executionSkills: ['PM', '標準化', 'データ活用'],
          },
        } as Project,
      ];

      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`✅ プロジェクト「${title}」を追加しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(`✅ プロジェクト「${title}」を追加しました（サーバーにも反映済み）`);
      } catch {
        setNotice(`⚠️ プロジェクト「${title}」の追加は画面上のみ反映されました（サーバー保存に失敗）`);
      }
    }
  };

  /* ===== 部門削除 ===== */
  const handleDeleteDepartment = async (index: number) => {
    if (!canEditCompany) {
      setNotice('⚠️ 部門削除は管理者のみ可能です');
      return;
    }

    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const target = current[index];
    if (!target) return;

    const ok = window.confirm(`「${target.name}」を削除しますか？\nこの操作は元に戻せません。`);
    if (!ok) return;

    pushToStore((prev) => {
      const raw = prev.filter((_, i) => i !== index);
      const next: Department[] = raw.map((d, i) => ({
        ...d,
        answers2: (d.answers2 ?? []).map((ch) => ({
          ...ch,
          chapterIndex: i,
          chapterTitle: d.name,
        })),
      }));
      return next;
    });

    // レーンキャッシュも掃除
    try {
      const copy = { ...laneCacheRef.current };
      delete copy[target.name];
      laneCacheRef.current = copy;
    } catch {
      // ignore
    }

    setNotice(`🗑 ${target.name} を削除しました`);

    if (saveNow) {
      try {
        await saveNow();
        setNotice(`🗑 ${target.name} を削除しました（サーバーにも反映済み）`);
      } catch {
        setNotice(`⚠️ ${target.name} の削除をサーバーに保存できませんでした（画面上は削除済み）`);
      }
    }
  };

  /* =========================
     /api/generate-cascade を使った全社一括生成（2レーン対応）
  ========================= */
  const handleCascadeGenerateAll = async () => {
    if (!canEditDept()) {
      setNotice('⚠️ AI一括生成は編集権限があるユーザーのみ実行できます');
      return;
    }
    if (!departments.length) {
      setNotice('⚠️ 部門が登録されていません');
      return;
    }

    const storyOrWarn = requireStoryOrWarn();
    if (!storyOrWarn) return;

    setIsCascadeGenerating(true);
    setNotice('✨ 全社の部門戦略案（ミッション・プロジェクト・KPI案）をAIが生成しています…');

    try {
      const payload: any = {
        thought: s?.thought ?? '',
        vision: s?.vision ?? '',
        mission: s?.mission ?? '',
        industry,
        revenue: s?.revenue ?? s?.company?.revenue,
        employees: s?.employees ?? s?.company?.employees,
        value: s?.value ?? '',
        strength: s?.strength ?? '',
        weakness: s?.weakness ?? '',
        opportunity: s?.opportunity ?? '',
        threat: s?.threat ?? '',
        story: rawStory,
        strategySummary: s?.strategySummary ?? '',
        departments: departments.map((d) => ({
          name: d.name,
          missionDraft: d.mission ?? d.strategy ?? d.missionDraft ?? '',
          projects: (d.projects as Project[] | undefined)?.map((p) => p.title) ?? [],
          okrs:
            (d.projects as Project[] | undefined)
              ?.flatMap((p) => (p.okrs ?? []) as StoreOKR[])
              .map((o) => ({
                objective: o.objective ?? '',
                keyResults: (o.keyResults ?? []).slice(),
                owner: o.owner ?? '',
                // ★あれば含める（AIの文脈を維持）
                expectedImpactYen: typeof o.expectedImpactYen === 'number' ? o.expectedImpactYen : undefined,
                probability: typeof o.probability === 'number' ? o.probability : undefined,
              })) ?? [],
          direction: (d as any).direction,
          expectations: (d as any).expectations,
          focusThemes: (d as any).focusThemes,
          answers: d.answers2?.[0]?.steps ?? [],
        })),
        csvFinanceData: s?.csvFinanceData ?? [],
        financeSummary: s?.financeSummary,
        businessPortfolio: s?.businessPortfolio,
        // ★STAGE2構造化データを追加
        winPatternPrimary,
        winPatternSecondary,
        valueDriverKPIs,
        targetRanges,
      };

      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      const data = safeJsonFromText<ApiCascadeResponse>(text);

      if (!res.ok || !data) {
        setNotice(`❌ 一括生成に失敗しました：${(data as any)?.error ?? res.statusText}`);
        return;
      }

      const resultDepts: ApiDeptDraft[] = Array.isArray(data.departments) ? data.departments : [];

      pushToStore((prev) => {
        const list = [...prev];

        for (const rd of resultDepts) {
          const name = (rd?.name ?? '').trim();
          if (!name) continue;
          const idx = list.findIndex((d) => d.name === name);
          if (idx < 0) continue;

          const d = list[idx];
          const existingProjects = (d.projects as Project[] | undefined) ?? [];
          const patch: Partial<Department> = {};

          // レーンキャッシュ（参考表示用）
          if (rd?.lanes?.existing || rd?.lanes?.new) {
            laneCacheRef.current[name] = {
              existing: rd?.lanes?.existing,
              new: rd?.lanes?.new,
            };
          } else {
            // 旧形式の場合は「existing」として保持（任意）
            if (Array.isArray(rd.projects) || Array.isArray(rd.okrDraft)) {
              laneCacheRef.current[name] = {
                existing: {
                  projects: Array.isArray(rd.projects) ? rd.projects : [],
                  okrDraft: Array.isArray(rd.okrDraft) ? rd.okrDraft : [],
                },
              };
            }
          }

          // ミッション
          const missionDraft = (rd.missionDraft ?? '').trim();
          if (
            missionDraft &&
            (!jsonEq(missionDraft, d.mission) ||
              !jsonEq(missionDraft, d.strategy) ||
              !jsonEq(missionDraft, d.missionDraft))
          ) {
            patch.mission = missionDraft;
            patch.strategy = missionDraft;
            patch.missionDraft = missionDraft;
          }

          // プロジェクト + OKR（旧＋2レーンを統合してマージ）
          const mergedProjects = applyDeptDraftToProjects(existingProjects, rd);
          if (!jsonEq(mergedProjects, existingProjects)) {
            patch.projects = mergedProjects;
          }

          // 任意：部門にフィールドがある場合のみ反映（型を壊さない）
          if (rd.needsCollab) (patch as any).needsCollab = rd.needsCollab;
          if (rd.stopList) (patch as any).stopList = rd.stopList;
          if (rd.first90Days) (patch as any).first90Days = rd.first90Days;
          if (rd.riskNotes) (patch as any).riskNotes = rd.riskNotes;

          if (Object.keys(patch).length > 0) {
            list[idx] = { ...d, ...patch } as Department;
          }
        }

        return list;
      });

      setNotice(
        '✅ 全社の部門ミッション・プロジェクト案・KPI案をAIで更新しました（既存データはできるだけ尊重してマージしています）',
      );

      if (saveNow) {
        try {
          await saveNow();
          setNotice('✅ 全社の部門戦略案を更新し、サーバーにも保存しました');
        } catch {
          setNotice('⚠️ 画面上の更新は完了しましたが、サーバー保存に失敗しました');
        }
      }
    } catch (e: any) {
      setNotice(`❌ 一括生成中にエラーが発生しました：${e?.message ?? '不明なエラー'}`);
    } finally {
      setIsCascadeGenerating(false);
    }
  };

  /* =========================
     この部門だけ：/api/generate-cascade を使ったたたき台生成（2レーン対応）
  ========================= */
  const handleDeptCascadeDraft = async (index: number) => {
    const story = requireStoryOrWarn();
    if (!story) return;
    if (!canEditDept()) return setNotice('⚠️ 編集権限がありません');

    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), deptDraft: true } }));

    try {
      const payload: any = {
        thought: s?.thought ?? '',
        vision: s?.vision ?? '',
        mission: s?.mission ?? '',
        industry,
        revenue: s?.revenue ?? s?.company?.revenue,
        employees: s?.employees ?? s?.company?.employees,
        value: s?.value ?? '',
        strength: s?.strength ?? '',
        weakness: s?.weakness ?? '',
        opportunity: s?.opportunity ?? '',
        threat: s?.threat ?? '',
        story: rawStory,
        strategySummary: s?.strategySummary ?? '',
        departments: [
          {
            name: dept.name,
            missionDraft: dept.mission ?? dept.strategy ?? dept.missionDraft ?? '',
            projects: ((dept.projects as Project[] | undefined) ?? []).map((p) => p.title),
            okrs:
              ((dept.projects as Project[] | undefined) ?? [])
                .flatMap((p) => (p.okrs ?? []) as StoreOKR[])
                .map((o) => ({
                  objective: o.objective ?? '',
                  keyResults: (o.keyResults ?? []).slice(),
                  owner: o.owner ?? '',
                  expectedImpactYen: typeof o.expectedImpactYen === 'number' ? o.expectedImpactYen : undefined,
                  probability: typeof o.probability === 'number' ? o.probability : undefined,
                })) ?? [],
            direction: (dept as any).direction,
            expectations: (dept as any).expectations,
            focusThemes: (dept as any).focusThemes,
            answers: dept.answers2?.[0]?.steps ?? [],
          },
        ],
        csvFinanceData: s?.csvFinanceData ?? [],
        financeSummary: s?.financeSummary,
        businessPortfolio: s?.businessPortfolio,
        // ★STAGE2構造化データを追加
        winPatternPrimary,
        winPatternSecondary,
        valueDriverKPIs,
        targetRanges,
      };

      const res = await fetch('/api/generate-cascade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      const data = safeJsonFromText<ApiCascadeResponse>(text);

      if (!res.ok || !data) {
        setNotice(`❌ 部門のたたき台生成に失敗しました：${(data as any)?.error ?? res.statusText}`);
        return;
      }

      const rd: ApiDeptDraft | null = Array.isArray(data.departments) ? data.departments[0] : null;
      if (!rd) {
        setNotice('⚠️ この部門のたたき台が取得できませんでした');
        return;
      }

      // レーンキャッシュ
      if (rd?.lanes?.existing || rd?.lanes?.new) {
        laneCacheRef.current[dept.name] = { existing: rd.lanes?.existing, new: rd.lanes?.new };
      } else {
        if (Array.isArray(rd.projects) || Array.isArray(rd.okrDraft)) {
          laneCacheRef.current[dept.name] = {
            existing: {
              projects: Array.isArray(rd.projects) ? rd.projects : [],
              okrDraft: Array.isArray(rd.okrDraft) ? rd.okrDraft : [],
            },
          };
        }
      }

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;

        const existingProjects = (d.projects as Project[] | undefined) ?? [];
        const patch: Partial<Department> = {};

        // ミッション
        const missionDraft = (rd.missionDraft ?? '').trim();
        if (
          missionDraft &&
          (!jsonEq(missionDraft, d.mission) ||
            !jsonEq(missionDraft, d.strategy) ||
            !jsonEq(missionDraft, d.missionDraft))
        ) {
          patch.mission = missionDraft;
          patch.strategy = missionDraft;
          patch.missionDraft = missionDraft;
        }

        // プロジェクト + OKR（旧＋2レーン統合）
        const mergedProjects = applyDeptDraftToProjects(existingProjects, rd);
        if (!jsonEq(mergedProjects, existingProjects)) {
          patch.projects = mergedProjects;
        }

        if (rd.needsCollab) (patch as any).needsCollab = rd.needsCollab;
        if (rd.stopList) (patch as any).stopList = rd.stopList;
        if (rd.riskNotes) (patch as any).riskNotes = rd.riskNotes;

        if (Object.keys(patch).length > 0) {
          list[index] = { ...d, ...patch } as Department;
        }

        return list;
      });

      setNotice(`✅ ${dept.name} のミッション・プロジェクト・KPI案を更新しました`);

      if (saveNow) {
        try {
          await saveNow();
          setNotice(`✅ ${dept.name} のたたき台を更新し、サーバーにも保存しました`);
        } catch {
          setNotice('⚠️ 画面上の更新は完了しましたが、サーバー保存に失敗しました');
        }
      }
    } catch (e: any) {
      setNotice(`❌ 部門のたたき台生成中にエラーが発生しました：${e?.message ?? '不明なエラー'}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), deptDraft: false } }));
    }
  };

  /* ===== 勝ち筋カタログベース：この部門のプロジェクト＆KPI案を生成 ===== */
  const handleDeptWinPatternGenerate = async (index: number) => {
    if (!canEditDept()) {
      setNotice('⚠️ プロジェクト＆KPI案の生成は編集権限があるユーザーのみ実行できます');
      return;
    }

    const story = requireStoryOrWarn();
    if (!story) return;

    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;

    const missionText = (dept.strategy ?? dept.mission ?? '').trim();

    const industryCode = detectIndustryCode(industry);
    const deptKind = detectDepartmentKind(dept.name);
    const leverPriority = detectLeverPriority(missionText, storyText, dept.name);

    setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), winPattern: true } }));
    setNotice(`✨ ${dept.name} のプロジェクト＆KPI案を「勝ち筋カタログ」から生成しています…`);

    try {
      const generated = generateProjectsForDepartment({
        industry: industryCode,
        departmentKind: deptKind,
        leverPriority,
        missionText,
        storyText,
        maxProjects: 3,
      });

      if (!generated.length) {
        setNotice(
          `⚠️ ${dept.name} に対して、勝ち筋カタログから該当するパターンが見つかりませんでした（業種・部門名の表現を見直すとマッチしやすくなります）`,
        );
        return;
      }

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;

        const existingProjects = (d.projects as Project[] | undefined) ?? [];
        let projects: Project[] = [...existingProjects];

        for (const gp of generated) {
          const title = gp.title || '無題のプロジェクト';
          const mappedLever = mapGrowthLeverToLever(gp.lever);
          const kind = mapLeverToKind(mappedLever);

          const rawOkr: StoreOKR | null =
            gp.objective || (gp.keyResults && gp.keyResults.length)
              ? {
                  objective: gp.objective || '',
                  keyResults: (gp.keyResults ?? []).map((x: any) => String(x ?? '')).filter(Boolean),
                  owner: undefined,
                }
              : null;

          const existIdx = projects.findIndex((p) => normalizeTitleKey(p.title ?? '') === normalizeTitleKey(title));

          if (existIdx >= 0) {
            const existing = { ...(projects[existIdx] as Project) };
            const baseOkrs: StoreOKR[] = [...(((existing.okrs ?? []) as StoreOKR[]) ?? [])];

            if (rawOkr) {
              if (!baseOkrs[0]) {
                baseOkrs[0] = rawOkr;
              } else if (
                !(baseOkrs[0].objective === rawOkr.objective && jsonEq(baseOkrs[0].keyResults, rawOkr.keyResults))
              ) {
                baseOkrs.push(rawOkr);
              }
            }

            const merged: Project = {
              ...existing,
              okrs: baseOkrs,
              hypothesis: existing.hypothesis || gp.description || '',
              mainLever: existing.mainLever || mappedLever,
              kind: existing.kind || kind,
            };

            merged.okrs = sanitizeOkrsForProject(merged, merged.okrs as StoreOKR[]);
            projects[existIdx] = merged;
          } else {
            const created: Project = {
              title,
              hypothesis: gp.description || '',
              mainLever: mappedLever,
              kind,
              okrs: rawOkr ? [rawOkr] : [],
            } as Project;

            created.okrs = sanitizeOkrsForProject(created, created.okrs as StoreOKR[]);
            projects.push(created);
          }
        }

        if (jsonEq(projects, existingProjects)) return prev;
        list[index] = { ...d, projects };
        return list;
      });

      setNotice(
        `✅ ${dept.name} のプロジェクト＆KPI案を「勝ち筋カタログ」ベースで追加しました（詳細はOKR画面で詰めてください）`,
      );

      if (saveNow) {
        try {
          await saveNow();
          setNotice(`✅ ${dept.name} の勝ち筋ドリブンなプロジェクト＆KPI案を追加し、サーバーにも保存しました`);
        } catch {
          setNotice(`⚠️ ${dept.name} の勝ち筋ドリブン案は画面上には反映されていますが、サーバー保存に失敗しました`);
        }
      }
    } catch (e: any) {
      setNotice(`❌ ${dept.name} の勝ち筋カタログ生成中にエラーが発生しました：${e?.message ?? '不明なエラー'}`);
    } finally {
      setLoading((p) => ({ ...p, [index]: { ...(p[index] || {}), winPattern: false } }));
    }
  };

  /* ===== ビジュアルビュー ===== */
  const VisualView = useMemo(() => {
    if (!departments.length) return <div className="text-zinc-600">部門がまだ登録されていません。</div>;
    return (
      <div className="grid md:grid-cols-2 gap-6">
        {departments.map((d, i) => (
          <VisualCard key={`v-${d.name}-${i}`} d={d} />
        ))}
      </div>
    );
  }, [departments]);

  /* map内 hooks 回避のためのメモ */
  const answersMemo: DeptAnswerStep[][] = useMemo(
    () => departments.map((d) => toDeptAnswers(d.answers2?.[0]?.steps)),
    [departments],
  );
  const projectsMemo: string[][] = useMemo(
    () => departments.map((d) => ((d.projects as Project[] | undefined) ?? []).map((p) => p.title)),
    [departments],
  );

  /* ===== JSX ===== */
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold mb-2">STAGE 3：部門戦略（カスケード）</h1>
        <p className="text-zinc-600 text-sm">
          経営ストーリーを基に、質問に答えながら各部門の<b>ミッション・プロジェクト案・KPI案（実現したい状態と主要指標）</b>
          を明確化します。
        </p>
      </header>

      {isHydrating && (
        <div className="mb-8 rounded-xl border p-4 text-sm text-muted-foreground flex items-center justify-between">
          <span>サーバーからデータを読み込んでいます…</span>
          <Button
            variant="secondary"
            className="h-8 rounded-full px-3"
            onClick={() => setHydrated?.(true)}
            title="強制的に読み込み完了にします"
          >
            手動で続行
          </Button>
        </div>
      )}

      {!isHydrating && (
        <section className="mb-8">
          {storyChapters.length ? (
            <div className="grid md:grid-cols-2 gap-4">
              {storyChapters.map((ch, i) => (
                <div key={i} className="p-4 border rounded-2xl bg-white/60 backdrop-blur-sm">
                  <h3 className="font-semibold">{ch.title}</h3>
                  <div
                    dangerouslySetInnerHTML={{ __html: nl2brSafe(ch.body) }}
                    className="text-sm text-zinc-700 mt-1"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-yellow-50 text-yellow-800 text-sm rounded-xl border border-yellow-200">
              経営ストーリーが未設定です。先に STAGE 2 で「経営ストーリー」を作成してください。
            </div>
          )}
        </section>
      )}

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="inline-flex border rounded-full overflow-hidden">
          {(['edit', 'visual'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm ${activeTab === t ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'}`}
              disabled={isHydrating}
            >
              {t === 'edit' ? '編集ビュー' : 'ビジュアルビュー'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end flex-wrap">
          <Button
            variant="outline"
            className="rounded-full h-9 px-4"
            disabled={isHydrating}
            onClick={async () => {
              if (!saveNow) return;
              try {
                setNotice('💾 保存中です…');
                await saveNow();
                setNotice('✅ 全体を保存しました（サーバーにも反映済み）');
              } catch (e: any) {
                setNotice(`❌ 保存に失敗しました：${e?.message ?? '不明なエラー'}`);
              }
            }}
          >
            <Save className="w-4 h-4 mr-1" />
            全体保存
          </Button>

          {departments.length > 0 && (
            <Button
              variant="outline"
              className="rounded-full h-9 px-4"
              disabled={isHydrating || isCascadeGenerating}
              onClick={handleCascadeGenerateAll}
              title="全ての部門について、ミッション・プロジェクト案・KPI案を一括生成します（2レーン対応）"
            >
              <Sparkles className="w-4 h-4 mr-1" />
              {isCascadeGenerating
                ? 'AIが全社のたたき台を生成中…'
                : 'AIで全社のたたき台（ミッション・プロジェクト・KPI案）'}
            </Button>
          )}

          {canEditCompany && (
            <Button onClick={() => setShowForm((v) => !v)} className="rounded-full h-9 px-4" disabled={isHydrating}>
              <PlusCircle className="w-4 h-4 mr-1" />
              {showForm ? '閉じる' : '部門を追加'}
            </Button>
          )}
        </div>
      </div>

      {showForm && canEditCompany && !isHydrating && (
        <div className="p-6 border rounded-3xl bg-white/70 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="部門名（例：営業部、人事部、生産本部など）"
              className="border rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={deptMission}
              onChange={(e) => setDeptMission(e.target.value)}
              placeholder="（任意）ミッションのメモ"
              className="border rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowForm(false)} className="rounded-full h-9 px-4">
              キャンセル
            </Button>
            <Button
              onClick={async () => {
                if (!deptName.trim()) return setNotice('⚠️ 部門名を入力してください');
                const baseName = deptName.trim();
                const baseMission = deptMission.trim();

                let nextLength = 0;
                pushToStore((prev) => {
                  const current = [...prev];
                  const newDept: Department = {
                    name: baseName,
                    mission: baseMission,
                    strategy: baseMission,
                    missionDraft: baseMission,
                    discussionNotes: '',
                    projects: [],
                    answers2: [{ chapterIndex: current.length, chapterTitle: baseName, steps: [] }],
                    finalized: false,
                  };
                  current.push(newDept);
                  nextLength = current.length;
                  return current;
                });

                setDeptName('');
                setDeptMission('');
                setShowForm(false);
                setNotice(`✅ ${baseName} を追加しました（部門数: ${nextLength}）`);

                if (saveNow) {
                  try {
                    await saveNow();
                    setNotice(`✅ ${baseName} を追加しました（サーバーにも反映済み）`);
                  } catch {
                    setNotice(`⚠️ ${baseName} の追加は画面上は反映されていますが、サーバー保存に失敗しました`);
                  }
                }
              }}
              className="rounded-full h-9 px-4"
            >
              追加
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <div className="mb-6 text-sm p-3 rounded-xl border bg-emerald-50 text-emerald-800">
          {notice}
        </div>
      )}

      {activeTab === 'visual' ? (
        <section>{VisualView}</section>
      ) : (
        <section className="space-y-6">
          {departments.map((dept, index) => {
            const editableDept = canEditDept();
            const L = loading[index] ?? {};
            const inlineDraft = (inlineEdit[index] ?? dept.strategy ?? dept.mission ?? '').toString();

            const answers = answersMemo[index];
            const projTitles = projectsMemo[index];
            const currentStoreSteps = dept.answers2?.[0]?.steps ?? [];

            const deptMissionText = (dept.strategy ?? dept.mission ?? '').trim();
            const deptProjects = (dept.projects as Project[] | undefined) ?? [];

            const lane = laneCacheRef.current[dept.name];
            const laneOpen = !!showLaneDetail[dept.name];

            const exCount = lane?.existing?.projects?.length ?? 0;
            const newCount = lane?.new?.projects?.length ?? 0;

            return (
              <div
                key={`e-${dept.name}-${index}`}
                className="p-6 border rounded-3xl bg-white/70 backdrop-blur-sm shadow-sm"
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> {dept.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    {dept.finalized && (
                      <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>
                    )}
                    {canEditCompany && (
                      <Button
                        variant="outline"
                        className="h-8 px-3 rounded-full border-red-500 text-red-600 hover:bg-red-50 flex items-center gap-1"
                        disabled={isHydrating}
                        onClick={() => handleDeleteDepartment(index)}
                        title="この部門を削除"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-xs">削除</span>
                      </Button>
                    )}
                  </div>
                </div>

                <textarea
                  value={inlineDraft}
                  onChange={(e) => setInlineEdit((p) => ({ ...p, [index]: e.target.value }))}
                  className="w-full border rounded-xl p-2 mb-2 text-sm"
                  readOnly={!editableDept || isHydrating}
                  placeholder="この部門の役割やミッションのイメージを記入してください（AIたたき台の修正もここで行います）"
                />

                <div className="flex flex-wrap gap-2 mb-1">
                  <Button
                    onClick={() => void saveInlineMission(index)}
                    disabled={!editableDept || isHydrating}
                    className="rounded-full h-9 px-4"
                  >
                    <Save className="w-4 h-4 mr-1" /> 保存
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleDeptCascadeDraft(index)}
                    disabled={!editableDept || !!L.deptDraft || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="この部門のミッション・プロジェクト案・KPI案をAIが提案します（2レーン対応）"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    {L.deptDraft ? 'たたき台を生成中…' : 'AIでこの部門のたたき台（ミッション・プロジェクト・KPI案）'}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleDeptWinPatternGenerate(index)}
                    disabled={!editableDept || !!L.winPattern || isHydrating}
                    className="rounded-full h-9 px-4"
                    title="勝ち筋カタログに基づき、この部門のプロジェクト＆KPI案を生成します"
                  >
                    <Sparkles className="w-4 h-4 mr-1" />
                    {L.winPattern ? '勝ち筋から生成中…' : '勝ち筋カタログからプロジェクト＆KPI案'}
                  </Button>

                  {(exCount > 0 || newCount > 0) && (
                    <Button
                      variant="outline"
                      className="rounded-full h-9 px-4"
                      disabled={isHydrating}
                      onClick={() =>
                        setShowLaneDetail((p) => ({
                          ...p,
                          [dept.name]: !p[dept.name],
                        }))
                      }
                      title="AI生成の内訳（既存進化／新規探索）を表示します"
                    >
                      {laneOpen ? (
                        <ChevronUp className="w-4 h-4 mr-1" />
                      ) : (
                        <ChevronDown className="w-4 h-4 mr-1" />
                      )}
                      生成内訳（既存{exCount} / 新規{newCount}）
                    </Button>
                  )}
                </div>

                {/* 価値指標（STAGE2）の表示 */}
                {valueDriverKPIs.length > 0 && (
                  <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2">
                    <div className="text-[11px] font-semibold text-blue-700 mb-1">価値指標（STAGE2で設定）</div>
                    <div className="flex flex-wrap gap-1">
                      {valueDriverKPIs.map((kpi: any, i: number) => (
                        <span key={i} className="inline-block px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200 text-[10px] text-blue-700">
                          {kpi?.label || kpi?.id || `指標${i + 1}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-zinc-500 mb-3">
                  ※ 「AIでこの部門のたたき台」はミッションも含めて生成します。/ 「勝ち筋カタログからプロジェクト＆KPI案」は、経営ストーリーと部門名・ミッションから
                  <b>勝ち筋ドリブンなプロジェクト＆KPI案</b>だけを追加生成します。詳細な数値や構造化は「OKR設定」画面で詰めてください。
                </p>

                {laneOpen && (exCount > 0 || newCount > 0) && (
                  <div className="mb-4 rounded-2xl border bg-white/60 p-3">
                    <div className="text-[11px] text-zinc-500 mb-2">
                      参考：/api/generate-cascade の「既存進化（Existing）」と「新規探索（New）」の内訳（保存データは統合済み）
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div className="rounded-xl border bg-white/70 p-3">
                        <div className="text-xs font-semibold text-zinc-800 mb-1">既存進化（Existing）</div>
                        {exCount > 0 ? (
                          <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-700">
                            {(lane?.existing?.projects ?? []).map((p, i) => (
                              <li key={`ex-${dept.name}-${i}`}>
                                {(p?.title ?? '無題').toString()}
                                {p?.mainLever ? (
                                  <span className="ml-2 text-[10px] text-zinc-500">
                                    [{String(p.mainLever)} / {String(p.horizon ?? '-')}]
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-zinc-500">（なし）</div>
                        )}
                      </div>

                      <div className="rounded-xl border bg-white/70 p-3">
                        <div className="text-xs font-semibold text-zinc-800 mb-1">新規探索（New）</div>
                        {newCount > 0 ? (
                          <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-700">
                            {(lane?.new?.projects ?? []).map((p, i) => (
                              <li key={`new-${dept.name}-${i}`}>
                                {(p?.title ?? '無題').toString()}
                                {p?.mainLever ? (
                                  <span className="ml-2 text-[10px] text-zinc-500">
                                    [{String(p.mainLever)} / {String(p.horizon ?? '-')}]
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-zinc-500">（なし）</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <DepartmentQuestionStepper
                  departmentName={dept.name}
                  mission={dept.strategy ?? dept.mission}
                  projects={projTitles}
                  okrs={[]}
                  initialStep={1}
                  initialAnswers={answers}
                  onChange={({ answers }) => {
                    if (!editableDept || isHydrating) return;
                    const nextSteps = toStoreSteps(answers);
                    if (jsonEq(nextSteps, currentStoreSteps)) return;

                    pushToStore((prev) => {
                      const list = [...prev];
                      const d = list[index];
                      if (!d) return prev;
                      const updated: Department = {
                        ...d,
                        answers2: [{ chapterIndex: index, chapterTitle: d.name, steps: nextSteps }],
                      };
                      list[index] = updated;
                      return list;
                    });
                  }}
                  onDraftGenerated={({ mission, projects, okrs }) => {
                    if (isHydrating) return;

                    pushToStore((prev) => {
                      const list = [...prev];
                      const d = list[index];
                      if (!d) return prev;

                      const patch: Partial<Department> = {};
                      if (mission && !jsonEq(mission, d.mission)) {
                        patch.mission = mission;
                        patch.strategy = mission;
                        patch.missionDraft = mission;
                      }
                      if (projects?.length) {
                        const projList: Project[] = projects.map((t) => ({
                          title: t,
                          okrs: [] as StoreOKR[],
                        }));
                        if (!jsonEq(projList, d.projects)) patch.projects = projList;
                      }
                      if (okrs?.length) {
                        const add: Project = {
                          title: '初期KPI案',
                          okrs: sanitizeOkrsForProject({ title: '初期KPI案' } as Project, [toStoreOKR(okrs[0])]),
                        };

                        const baseProjects: Project[] =
                          (patch.projects as Project[] | undefined) ??
                          ((d.projects as Project[] | undefined) ?? []);
                        const merged: Project[] = [...baseProjects, add];

                        if (!jsonEq(merged, d.projects)) {
                          patch.projects = merged;
                        }
                      }
                      const changed = Object.keys(patch).length > 0;
                      if (!changed) return prev;

                      list[index] = { ...d, ...patch } as Department;
                      return list;
                    });

                    setNotice(`✅ ${dept.name} のたたき台を反映しました`);
                  }}
                />

                {deptProjects && deptProjects.length > 0 && (
                  <div className="mt-5 border-t pt-4">
                    {deptMissionText && (
                      <div className="mb-3 rounded-2xl border bg-zinc-50 px-3 py-2">
                        <div className="text-[11px] text-zinc-500 mb-1">この部門のミッション</div>
                        <div className="text-sm text-zinc-800 whitespace-pre-wrap">{deptMissionText}</div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-2 gap-2">
                      <h4 className="text-sm font-semibold text-zinc-800">プロジェクト案とKPI案</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-500 hidden sm:inline">
                          ※ 詳細な編集や構造化は「OKR設定」画面でも行えます。
                        </span>
                        {editableDept && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-3 rounded-full text-[11px]"
                            disabled={isHydrating}
                            onClick={() => handleAddProject(index)}
                          >
                            <PlusCircle className="w-3 h-3 mr-1" />
                            プロジェクトを追加
                          </Button>
                        )}
                      </div>
                    </div>

                    <p className="sm:hidden text-[11px] text-zinc-500 mb-2">
                      ※ 詳細な編集や構造化は「OKR設定」画面でも行えます。
                    </p>

                    <ul className="space-y-2">
                      {deptProjects.map((p, pi) => {
                        const primaryOKR = (p.okrs?.[0] as StoreOKR | undefined) ?? undefined;
                        const primaryObjective = primaryOKR?.objective ?? '';
                        const krs = ((primaryOKR?.keyResults ?? []) as any[])
                          .filter((kr) => typeof kr === 'string') as string[];
                        const owner = primaryOKR?.owner ?? '';

                        return (
                          <li
                            key={`${dept.name}-proj-${pi}`}
                            className="flex flex-col gap-2 rounded-2xl border px-3 py-2 bg-white/70"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-zinc-500">•</span>
                                  <input
                                    className="flex-1 text-sm font-medium text-zinc-900 bg-transparent border-b border-dashed border-zinc-300 focus:outline-none focus:border-zinc-500"
                                    value={p.title || ''}
                                    placeholder="プロジェクト名を入力（例：新規顧客開拓の強化、人事評価制度の見直し など）"
                                    readOnly={!editableDept || isHydrating}
                                    onChange={(e) => {
                                      if (!editableDept || isHydrating) return;
                                      const val = e.target.value;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                        proj.title = val;
                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {editableDept && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 rounded-full border-red-500 text-red-600 hover:bg-red-50 text-[11px]"
                                    disabled={!editableDept || isHydrating}
                                    onClick={() => handleDeleteProject(index, pi)}
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    削除
                                  </Button>
                                )}
                              </div>
                            </div>

                            {(p.hypothesis || p.mainLever || p.horizon || p.kind) && (
                              <div className="pl-5 mt-1">
                                {p.hypothesis && (
                                  <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">仮説：{p.hypothesis}</p>
                                )}
                                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                                  {p.kind && (
                                    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                                      {KIND_LABEL[p.kind]}
                                    </span>
                                  )}
                                  {p.mainLever && (
                                    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                                      {LEVER_LABEL[p.mainLever]}
                                    </span>
                                  )}
                                  {p.horizon && (
                                    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">
                                      {HORIZON_LABEL[p.horizon]}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="pl-5 mt-2">
                              <div className="text-[11px] text-zinc-500 mb-1">
                                KPI（実現したい状態）
                              </div>
                              <input
                                className="w-full text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                value={primaryObjective}
                                placeholder="例）このプロジェクトにより、狙う成果が再現性をもって出る状態を確立する"
                                readOnly={!editableDept || isHydrating}
                                onChange={(e) => {
                                  if (!editableDept || isHydrating) return;
                                  const val = e.target.value;
                                  pushToStore((prev) => {
                                    const list = [...prev];
                                    const d = list[index];
                                    if (!d) return prev;
                                    const projects = [...((d.projects as Project[]) ?? [])];
                                    const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                    const okrs: StoreOKR[] = [...(((proj.okrs ?? []) as StoreOKR[]) ?? [])];
                                    if (!okrs[0]) okrs[0] = { objective: '', keyResults: [], owner: undefined };

                                    // ★既存メタ（expectedImpactYen/probability）を落とさない
                                    okrs[0] = { ...okrs[0], objective: val };

                                    proj.okrs = okrs;
                                    proj.okrs = sanitizeOkrsForProject(proj, proj.okrs as StoreOKR[]);

                                    projects[pi] = proj;
                                    list[index] = { ...d, projects };
                                    return list;
                                  });
                                }}
                              />
                            </div>

                            <div className="pl-5 mt-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] text-zinc-500">主要指標（KPI指標案）</div>
                                {editableDept && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 rounded-full text-[11px]"
                                    disabled={isHydrating}
                                    onClick={() => {
                                      if (!editableDept || isHydrating) return;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                        const okrs: StoreOKR[] = [...(((proj.okrs ?? []) as StoreOKR[]) ?? [])];
                                        if (!okrs[0]) okrs[0] = { objective: '', keyResults: [], owner: undefined };
                                        const nextKrs = [...(okrs[0].keyResults ?? [])];
                                        nextKrs.push('');
                                        okrs[0] = { ...okrs[0], keyResults: nextKrs };
                                        proj.okrs = okrs;

                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  >
                                    <PlusCircle className="w-3 h-3 mr-1" />
                                    指標を追加
                                  </Button>
                                )}
                              </div>

                              {krs.length === 0 && (
                                <p className="text-[11px] text-zinc-400">
                                  まだ指標案がありません。必要に応じて「指標を追加」から入力してください。
                                </p>
                              )}

                              {krs.map((kr, ki) => (
                                <div key={ki} className="flex items-center gap-2">
                                  <span className="text-[11px] text-zinc-400 whitespace-nowrap">指標{ki + 1}</span>
                                  <input
                                    className="flex-1 text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                    value={kr}
                                    placeholder="例）成功条件を合意し、実行設計を確定する／主要指標の計測手段を確立する 等"
                                    readOnly={!editableDept || isHydrating}
                                    onChange={(e) => {
                                      if (!editableDept || isHydrating) return;
                                      const val = e.target.value;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                        const okrs: StoreOKR[] = [...(((proj.okrs ?? []) as StoreOKR[]) ?? [])];
                                        if (!okrs[0]) okrs[0] = { objective: '', keyResults: [], owner: undefined };
                                        const nextKrs = [...(okrs[0].keyResults ?? [])];
                                        nextKrs[ki] = val;
                                        okrs[0] = { ...okrs[0], keyResults: nextKrs };
                                        proj.okrs = okrs;

                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  />
                                  {editableDept && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 rounded-full text-[11px] border-red-400 text-red-600 hover:bg-red-50"
                                      disabled={isHydrating}
                                      onClick={() => {
                                        if (!editableDept || isHydrating) return;
                                        pushToStore((prev) => {
                                          const list = [...prev];
                                          const d = list[index];
                                          if (!d) return prev;
                                          const projects = [...((d.projects as Project[]) ?? [])];
                                          const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                          const okrs: StoreOKR[] = [...(((proj.okrs ?? []) as StoreOKR[]) ?? [])];
                                          if (!okrs[0]) return prev;
                                          const nextKrs = [...(okrs[0].keyResults ?? [])];
                                          nextKrs.splice(ki, 1);
                                          okrs[0] = { ...okrs[0], keyResults: nextKrs };
                                          proj.okrs = okrs;

                                          projects[pi] = proj;
                                          list[index] = { ...d, projects };
                                          return list;
                                        });
                                      }}
                                    >
                                      削除
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="pl-5 mt-2">
                              <div className="text-[11px] text-zinc-500 mb-1">主な担当（Owner）</div>
                              <input
                                className="w-full text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                value={owner}
                                placeholder="例）営業部長、人事部マネジャー、工場長 など"
                                readOnly={!editableDept || isHydrating}
                                onChange={(e) => {
                                  if (!editableDept || isHydrating) return;
                                  const val = e.target.value;
                                  pushToStore((prev) => {
                                    const list = [...prev];
                                    const d = list[index];
                                    if (!d) return prev;
                                    const projects = [...((d.projects as Project[]) ?? [])];
                                    const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                    const okrs: StoreOKR[] = [...(((proj.okrs ?? []) as StoreOKR[]) ?? [])];
                                    if (!okrs[0]) okrs[0] = { objective: '', keyResults: [], owner: undefined };
                                    okrs[0] = { ...okrs[0], owner: val || undefined };
                                    proj.okrs = okrs;

                                    projects[pi] = proj;
                                    list[index] = { ...d, projects };
                                    return list;
                                  });
                                }}
                              />
                            </div>

                            {/* ========== 価値指標紐づけセクション（STAGE3拡張） ========== */}
                            {valueDriverKPIs.length > 0 && (
                              <div className="pl-5 mt-3 pt-3 border-t border-zinc-100">
                                <div className="text-[11px] font-semibold text-zinc-700 mb-2">効かせる価値指標（STAGE2との連携）</div>
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {valueDriverKPIs.map((kpi: any) => {
                                    const kpiId = kpi?.id || kpi?.label;
                                    const isLinked = (p.valueDriverLinks ?? []).includes(kpiId);
                                    return (
                                      <button
                                        key={kpiId}
                                        className={[
                                          'px-2 py-1 rounded-full text-[10px] font-medium transition-colors border',
                                          isLinked
                                            ? 'bg-blue-500 text-white border-blue-600'
                                            : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50',
                                        ].join(' ')}
                                        disabled={!editableDept || isHydrating}
                                        onClick={() => {
                                          if (!editableDept || isHydrating) return;
                                          pushToStore((prev) => {
                                            const list = [...prev];
                                            const d = list[index];
                                            if (!d) return prev;
                                            const projects = [...((d.projects as Project[]) ?? [])];
                                            const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                            const links = [...(proj.valueDriverLinks ?? [])];
                                            const idx = links.indexOf(kpiId);
                                            if (idx >= 0) {
                                              links.splice(idx, 1);
                                            } else {
                                              links.push(kpiId);
                                            }
                                            proj.valueDriverLinks = links;
                                            projects[pi] = proj;
                                            list[index] = { ...d, projects };
                                            return list;
                                          });
                                        }}
                                        title={isLinked ? `「${kpi?.label || kpiId}」との紐づけを解除` : `「${kpi?.label || kpiId}」に効かせる`}
                                      >
                                        {isLinked && '✓ '}
                                        {kpi?.label || kpiId}
                                      </button>
                                    );
                                  })}
                                </div>
                                {(!p.valueDriverLinks || p.valueDriverLinks.length === 0) && (
                                  <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                                    ⚠️ 価値指標が未設定です。このプロジェクトがどの価値指標に効くかを選択してください。
                                  </div>
                                )}
                              </div>
                            )}
                            {/* ========== 価値指標紐づけセクション終了 ========== */}

                            {/* ========== 人的投資セクション（STAGE3拡張） ========== */}
                            <div className="pl-5 mt-4 pt-4 border-t border-zinc-100">
                              <div className="text-[11px] font-semibold text-zinc-700 mb-3">人的投資（スキル要件＋施策案）</div>

                              {/* スキル要件 */}
                              <div className="mb-3">
                                <div className="text-[10px] text-zinc-500 mb-1">職種スキル</div>
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {(p.skillRequirements?.roleSkills ?? []).map((skill, si) => (
                                    <span key={si} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[10px] text-blue-700">
                                      {skill}
                                      {editableDept && (
                                        <button
                                          className="hover:text-red-600"
                                          onClick={() => {
                                            if (!editableDept || isHydrating) return;
                                            pushToStore((prev) => {
                                              const list = [...prev];
                                              const d = list[index];
                                              if (!d) return prev;
                                              const projects = [...((d.projects as Project[]) ?? [])];
                                              const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                              const skills = { ...proj.skillRequirements };
                                              const roleSkills = [...(skills.roleSkills ?? [])];
                                              roleSkills.splice(si, 1);
                                              skills.roleSkills = roleSkills;
                                              proj.skillRequirements = skills;
                                              projects[pi] = proj;
                                              list[index] = { ...d, projects };
                                              return list;
                                            });
                                          }}
                                        >×</button>
                                      )}
                                    </span>
                                  ))}
                                  {editableDept && (
                                    <button
                                      className="px-2 py-0.5 rounded-full border border-dashed border-zinc-300 text-[10px] text-zinc-500 hover:bg-zinc-50"
                                      onClick={() => {
                                        if (!editableDept || isHydrating) return;
                                        const newSkill = window.prompt('職種スキルを入力（例：営業、エンジニア、デザイナー）');
                                        if (!newSkill?.trim()) return;
                                        pushToStore((prev) => {
                                          const list = [...prev];
                                          const d = list[index];
                                          if (!d) return prev;
                                          const projects = [...((d.projects as Project[]) ?? [])];
                                          const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                          const skills = { ...proj.skillRequirements };
                                          const roleSkills = [...(skills.roleSkills ?? []), newSkill.trim()];
                                          skills.roleSkills = roleSkills;
                                          proj.skillRequirements = skills;
                                          projects[pi] = proj;
                                          list[index] = { ...d, projects };
                                          return list;
                                        });
                                      }}
                                    >+ 追加</button>
                                  )}
                                </div>
                              </div>

                              <div className="mb-3">
                                <div className="text-[10px] text-zinc-500 mb-1">実行スキル</div>
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {(p.skillRequirements?.executionSkills ?? []).map((skill, si) => (
                                    <span key={si} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-[10px] text-green-700">
                                      {skill}
                                      {editableDept && (
                                        <button
                                          className="hover:text-red-600"
                                          onClick={() => {
                                            if (!editableDept || isHydrating) return;
                                            pushToStore((prev) => {
                                              const list = [...prev];
                                              const d = list[index];
                                              if (!d) return prev;
                                              const projects = [...((d.projects as Project[]) ?? [])];
                                              const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                              const skills = { ...proj.skillRequirements };
                                              const executionSkills = [...(skills.executionSkills ?? [])];
                                              executionSkills.splice(si, 1);
                                              skills.executionSkills = executionSkills;
                                              proj.skillRequirements = skills;
                                              projects[pi] = proj;
                                              list[index] = { ...d, projects };
                                              return list;
                                            });
                                          }}
                                        >×</button>
                                      )}
                                    </span>
                                  ))}
                                  {editableDept && (
                                    <button
                                      className="px-2 py-0.5 rounded-full border border-dashed border-zinc-300 text-[10px] text-zinc-500 hover:bg-zinc-50"
                                      onClick={() => {
                                        if (!editableDept || isHydrating) return;
                                        const newSkill = window.prompt('実行スキルを入力（例：PM、標準化、データ活用、改善運用）');
                                        if (!newSkill?.trim()) return;
                                        pushToStore((prev) => {
                                          const list = [...prev];
                                          const d = list[index];
                                          if (!d) return prev;
                                          const projects = [...((d.projects as Project[]) ?? [])];
                                          const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                          const skills = { ...proj.skillRequirements };
                                          const executionSkills = [...(skills.executionSkills ?? []), newSkill.trim()];
                                          skills.executionSkills = executionSkills;
                                          proj.skillRequirements = skills;
                                          projects[pi] = proj;
                                          list[index] = { ...d, projects };
                                          return list;
                                        });
                                      }}
                                    >+ 追加</button>
                                  )}
                                </div>
                                {(!p.skillRequirements?.executionSkills || p.skillRequirements.executionSkills.length === 0) && (
                                  <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                                    ⚠️ 実行スキルが未設定です。PM、標準化、データ活用などを追加してください。
                                  </div>
                                )}
                              </div>

                              {/* 人的投資施策 */}
                              <div className="mt-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-[10px] text-zinc-500">人的投資施策（カテゴリ別）</div>
                                </div>
                                {(() => {
                                  const investments = p.humanInvestments ?? [];
                                  const categories: HumanInvestmentCategory[] = ['TRAINING_OJT', 'HIRING', 'ALLOCATION', 'EXTERNAL', 'TOOLS_PROCESS'];
                                  const categoryLabels: Record<HumanInvestmentCategory, string> = {
                                    TRAINING_OJT: '研修・OJT',
                                    HIRING: '採用',
                                    ALLOCATION: '配置・異動',
                                    EXTERNAL: '外部活用',
                                    TOOLS_PROCESS: 'ツール・仕組み',
                                  };
                                  const uniqueCategories = new Set(investments.map(inv => inv.category));
                                  const hasTwoOrMoreCategories = uniqueCategories.size >= 2;

                                  return (
                                    <>
                                      {!hasTwoOrMoreCategories && (
                                        <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                                          ⚠️ 人的投資施策のカテゴリが2種類未満です。多角的な施策を検討してください。
                                        </div>
                                      )}
                                      <div className="space-y-2">
                                        {categories.map((category) => {
                                          const items = investments.filter(inv => inv.category === category);
                                          return (
                                            <div key={category} className="rounded-lg border border-zinc-100 bg-white p-2">
                                              <div className="flex items-center justify-between mb-1">
                                                <div className="text-[10px] font-semibold text-zinc-700">{categoryLabels[category]}</div>
                                                {editableDept && (
                                                  <button
                                                    className="text-[10px] text-blue-600 hover:underline"
                                                    onClick={() => {
                                                      if (!editableDept || isHydrating) return;
                                                      const title = window.prompt(`${categoryLabels[category]}の施策を入力`);
                                                      if (!title?.trim()) return;
                                                      pushToStore((prev) => {
                                                        const list = [...prev];
                                                        const d = list[index];
                                                        if (!d) return prev;
                                                        const projects = [...((d.projects as Project[]) ?? [])];
                                                        const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                                        const newInv: HumanInvestment = { category, title: title.trim() };
                                                        proj.humanInvestments = [...(proj.humanInvestments ?? []), newInv];
                                                        projects[pi] = proj;
                                                        list[index] = { ...d, projects };
                                                        return list;
                                                      });
                                                    }}
                                                  >+ 追加</button>
                                                )}
                                              </div>
                                              {items.length === 0 ? (
                                                <div className="text-[10px] text-zinc-400">（未設定）</div>
                                              ) : (
                                                <ul className="space-y-1">
                                                  {items.map((inv, ii) => (
                                                    <li key={ii} className="text-[10px] text-zinc-700 flex items-start gap-1">
                                                      <span className="flex-1">• {inv.title}{inv.detail ? ` (${inv.detail})` : ''}</span>
                                                      {editableDept && (
                                                        <button
                                                          className="text-red-600 hover:underline"
                                                          onClick={() => {
                                                            if (!editableDept || isHydrating) return;
                                                            pushToStore((prev) => {
                                                              const list = [...prev];
                                                              const d = list[index];
                                                              if (!d) return prev;
                                                              const projects = [...((d.projects as Project[]) ?? [])];
                                                              const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                                              const allInv = [...(proj.humanInvestments ?? [])];
                                                              const globalIndex = allInv.findIndex((x, idx) => x === inv && items.indexOf(x) === ii);
                                                              if (globalIndex >= 0) allInv.splice(globalIndex, 1);
                                                              proj.humanInvestments = allInv;
                                                              projects[pi] = proj;
                                                              list[index] = { ...d, projects };
                                                              return list;
                                                            });
                                                          }}
                                                        >削除</button>
                                                      )}
                                                    </li>
                                                  ))}
                                                </ul>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            {/* ========== 人的投資セクション終了 ========== */}

                            {(primaryObjective || krs.length > 0 || owner) && editableDept && (
                              <div className="pl-5 mt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-3 rounded-full text-[11px] border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                                  disabled={isHydrating}
                                  onClick={() => {
                                    if (!editableDept || isHydrating) return;
                                    const ok = window.confirm(
                                      'このプロジェクトのKPI案（目標・指標・担当）をすべてクリアしますか？',
                                    );
                                    if (!ok) return;
                                    pushToStore((prev) => {
                                      const list = [...prev];
                                      const d = list[index];
                                      if (!d) return prev;
                                      const projects = [...((d.projects as Project[]) ?? [])];
                                      const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                      proj.okrs = [];
                                      projects[pi] = proj;
                                      list[index] = { ...d, projects };
                                      return list;
                                    });
                                    setNotice('🗑 このプロジェクトのKPI案をクリアしました');
                                  }}
                                >
                                  KPI案をすべてクリア
                                </Button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {(!deptProjects || deptProjects.length === 0) && editableDept && (
                  <div className="mt-4">
                    {deptMissionText && (
                      <div className="mb-3 rounded-2xl border bg-zinc-50 px-3 py-2">
                        <div className="text-[11px] text-zinc-500 mb-1">この部門のミッション</div>
                        <div className="text-sm text-zinc-800 whitespace-pre-wrap">{deptMissionText}</div>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 rounded-full text-[12px]"
                      disabled={isHydrating}
                      onClick={() => handleAddProject(index)}
                    >
                      <PlusCircle className="w-3 h-3 mr-1" />
                      プロジェクトを追加
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
