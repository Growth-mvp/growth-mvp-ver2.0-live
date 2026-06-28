// /app/api/recommend-exec-patterns/route.ts
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { execPatterns } from '@/lib/strategyPatterns.exec';
import { EXEC_IDS, type ExecPatternId } from '@/lib/strategyPatterns.map';

/** ========== 入出力型 ========== */
type CompanySignals = {
  industry?: string;
  goals?: string[];       // 例: ['海外売上','DX','粗利改善']
  pains?: string[];       // 例: ['解約率高い','在庫過多','リードタイム長い','データ活用不足']
  funnel?: string[];      // 例: ['CVR低い','導線複雑','稟議長い']
  metrics?: { churnHigh?: boolean; arpuLow?: boolean; marginLow?: boolean; velocityLow?: boolean };
  channels?: string[];    // 例: ['直販','代理店','EC','パートナー']
  initiatives?: string[]; // 例: ['値上げ','価格改定','SOP化','週次改善','PoC','デモ']
};

type Score = { id: ExecPatternId; score: number; why: string[] };

type RecommendDetail = {
  id: ExecPatternId;
  title: string;
  score: number;
  why: string[];
};

type RecommendResult = {
  recommended: ExecPatternId[];
  detail: RecommendDetail[];
};

/** タイトル辞書（execPatterns から生成） */
const TITLES: Record<ExecPatternId, string> = Object.fromEntries(
  execPatterns
    .filter(p => EXEC_IDS.includes(p.id as ExecPatternId))
    .map(p => [p.id as ExecPatternId, p.title || (p.id as string)])
) as Record<ExecPatternId, string>;

/** ========== シノニム（軽量） ========== */
const SYNONYMS: Record<string, string[]> = {
  'CVR低い': ['cvr低','コンバージョン低','成約率低','ドロップ'],
  '導線複雑': ['導線複雑','ステップ多い','手続き多い','摩擦','フリクション'],
  '稟議長い': ['稟議長い','承認長い','リードタイム長い'],
  '解約率高い': ['解約','離脱','チャーン','継続率低'],
  'データ活用不足': ['データ活用不足','可視化不足','分析不足','属人','手作業'],
  '価格抵抗': ['価格抵抗','高いと言われる','値引き要求','値下げ圧'],
  '在庫過多': ['在庫過多','だぶつき'],
  '欠品': ['欠品','在庫切れ'],
  '週次改善': ['wbr','週間改善','週次改善','改善ループ'],
  'SOP': ['sop','標準化','手順書','プレイブック'],
  'デモ/試算': ['デモ','poc','試算','サンプル','お試し'],
  '直販': ['直販','インサイド','フィールド'],
  '代理店': ['代理店','パートナー','チャネル'],
};

/** utils */
function expandTokens(tokens?: Array<string | undefined> | null): string[] {
  const out: string[] = [];
  for (const raw of tokens ?? []) {
    if (!raw || typeof raw !== 'string') continue;
    const t = raw.toLowerCase().trim();
    if (!t) continue;
    out.push(t);
    for (const [k, vs] of Object.entries(SYNONYMS)) {
      if (vs.some(v => t.includes(v.toLowerCase()))) out.push(k.toLowerCase());
    }
  }
  return Array.from(new Set(out));
}

function hasAny(
  list?: Array<string | undefined> | null,
  needles?: Array<string | undefined> | null
) {
  const a = expandTokens(list);
  const b = expandTokens(needles);
  if (!a.length || !b.length) return false;
  return b.some(n => a.some(x => x.includes(n) || n.includes(x)));
}

/** ========== スコアリング（e1〜e10） ========== */
function recommendExecPatterns(signals: CompanySignals, k: number = 3): RecommendResult {
  const rules: Array<(s: CompanySignals) => Score[]> = [
    // e1: 一点突破・水平展開
    (s) => {
      const h: string[] = [];
      if (hasAny(s.goals, ['収益性向上','成長','集中'])) h.push('成長/集中テーマがある');
      if (hasAny(s.pains, ['資源分散'])) h.push('資源分散→焦点化が必要');
      return [{ id: 'e1', score: 1.8 * h.length, why: h }];
    },
    // e2: 単価×価値の再定義
    (s) => {
      const h: string[] = [];
      if (hasAny(s.pains, ['価格抵抗'])) h.push('価格抵抗が強い');
      if (hasAny(s.initiatives, ['値上げ','価格改定'])) h.push('価格再設計を検討中');
      if (s.metrics?.marginLow) h.push('利益率が低い');
      return [{ id: 'e2', score: 2.2 * h.length, why: h }];
    },
    // e3: 既存顧客深耕 > 新規獲得
    (s) => {
      const h: string[] = [];
      if (s.metrics?.churnHigh || hasAny(s.pains, ['解約率高い'])) h.push('チャーンが痛い');
      if (hasAny(s.goals, ['LTV','顧客価値'])) h.push('既存価値の最大化');
      return [{ id: 'e3', score: 2.2 * h.length, why: h }];
    },
    // e4: フリクション撲滅ファネル
    (s) => {
      const h: string[] = [];
      if (hasAny(s.funnel, ['CVR低い','導線複雑'])) h.push('CVR/導線課題');
      if (hasAny(s.funnel, ['稟議長い'])) h.push('稟議リードタイムが長い');
      return [{ id: 'e4', score: 2.4 * h.length, why: h }];
    },
    // e5: 現場主導の週次改善ループ
    (s) => {
      const h: string[] = [];
      if (s.metrics?.velocityLow) h.push('ベロシティ低い');
      if (hasAny(s.initiatives, ['週次改善'])) h.push('WBR/改善ループ志向');
      if (hasAny(s.pains, ['属人'])) h.push('属人解消へ小改善');
      return [{ id: 'e5', score: 1.8 * h.length, why: h }];
    },
    // e6: 顧客課題の前倒し解決（試供体験）
    (s) => {
      const h: string[] = [];
      if (hasAny(s.initiatives, ['デモ/試算'])) h.push('デモ/試算で前倒し価値提供');
      if (hasAny(s.pains, ['リードタイム長い']) || hasAny(s.funnel, ['稟議長い'])) h.push('意思決定を早めたい');
      return [{ id: 'e6', score: 2.0 * h.length, why: h }];
    },
    // e7: やらないこと宣言
    (s) => {
      const h: string[] = [];
      if (hasAny(s.pains, ['多機能','拡散','フォーカス不足','資源分散'])) h.push('多機能化/拡散の痛み');
      return [{ id: 'e7', score: 1.6 * h.length, why: h }];
    },
    // e8: チャネル二刀流（直販×間接）
    (s) => {
      const h: string[] = [];
      if (hasAny(s.channels, ['直販']) && hasAny(s.channels, ['代理店'])) h.push('直販×間接の併用');
      if (hasAny(s.goals, ['販路拡大','スケール','海外売上'])) h.push('スケール/移植に向けたチャネル設計');
      return [{ id: 'e8', score: 1.8 * h.length, why: h }];
    },
    // e9: 原価の物語化（納得価格）
    (s) => {
      const h: string[] = [];
      if (hasAny(s.pains, ['価格抵抗'])) h.push('価格理由の語れなさ');
      if (hasAny(s.goals, ['顧客価値'])) h.push('価値の裏側の可視化');
      return [{ id: 'e9', score: 1.6 * h.length, why: h }];
    },
    // e10: 勝ち筋の標準化（オンボ90点）
    (s) => {
      const h: string[] = [];
      if (hasAny(s.initiatives, ['SOP'])) h.push('型のSOP/プレイブック化');
      if (hasAny(s.pains, ['属人'])) h.push('人依存からの脱却');
      if (hasAny(s.goals, ['DX','収益性向上'])) h.push('生産性/再現性の強化');
      return [{ id: 'e10', score: 2.0 * h.length, why: h }];
    },
  ];

  // スコア集計
  const map = new Map<ExecPatternId, Score>();
  for (const rule of rules) {
    for (const sc of rule(signals)) {
      const prev = map.get(sc.id) || { id: sc.id, score: 0, why: [] as string[] };
      map.set(sc.id, { id: sc.id, score: prev.score + sc.score, why: prev.why.concat(sc.why) });
    }
  }

  // 軽い業種バイアス & 同点安定化
  const industry = (signals.industry ?? '').toLowerCase().trim();
  const bias = (id: ExecPatternId) => {
    if (industry === 'manufacturing' && (id === 'e6' || id === 'e8')) return 0.2;
    if (industry === 'saas' && (id === 'e3' || id === 'e4' || id === 'e5')) return 0.2;
    if (industry === 'retail' && (id === 'e2' || id === 'e4' || id === 'e9')) return 0.15;
    return 0;
  };

  const ranked = Array.from(map.values())
    .map(v => ({ ...v, score: v.score + bias(v.id) }))
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));

  // k を尊重しつつ 2〜4件にクランプ
  const pick = Math.max(2, Math.min(4, Math.round(k || 3)));
  const topK = ranked.slice(0, pick);

  const detail: RecommendDetail[] = topK.map(x => ({
    id: x.id,
    title: TITLES[x.id],
    score: Number(x.score.toFixed(2)),
    why: Array.from(new Set(x.why)),
  }));

  return { recommended: topK.map(x => x.id), detail };
}

/** ========== API ========== */
export async function POST(req: NextRequest) {
  try {
    // Bearer 認証チェック
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Membership 確認
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { signals?: CompanySignals; k?: number };
    const signals = body?.signals ?? {};
    const res = recommendExecPatterns(signals, body?.k ?? 3);
    return NextResponse.json(res, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'server_error', detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
