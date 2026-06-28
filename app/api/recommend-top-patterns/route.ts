// /app/api/recommend-top-patterns/route.ts
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { topPatterns, type TopPatternId } from '@/lib/strategyPatterns.top';

/** ========== 型定義（このファイル内に閉じる） ========== */
type CompanySignals = {
  industry?: string;
  goals?: string[];   // 例: ['海外売上','粗利改善','DX']
  pains?: string[];   // 例: ['在庫過多','リードタイム長い','データ活用不足','解約率高い']
  swot?: { strengths?: string[]; weaknesses?: string[]; opportunities?: string[]; threats?: string[] };
  metrics?: { roicLow?: boolean; churnHigh?: boolean; marginLow?: boolean; overseasRatioLow?: boolean };
  risk?: { supplyRiskHigh?: boolean; geoRiskHigh?: boolean };
  initiatives?: string[]; // 例: ['M&A','提携']
};

type PatternId = TopPatternId;
type Score = { id: PatternId; score: number; why: string[] };

type RecommendDetail = {
  id: PatternId;
  title: string;
  score: number;
  why: string[];
};

type RecommendResult = {
  recommended: PatternId[];
  detail: RecommendDetail[];
};

/** タイトル辞書は topPatterns から生成（正の一本化） */
const TITLES: Record<PatternId, string> = Object.fromEntries(
  topPatterns.map(p => [p.id, p.title])
) as Record<PatternId, string>;

/** ========== シノニム辞書（軽量な同義語展開） ========== */
const SYNONYMS: Record<string, string[]> = {
  '海外売上': ['海外売上','海外展開','グローバル','越境','輸出'],
  'DX': ['DX','デジタル化','自動化','業務効率化','属人化解消'],
  '解約率高い': ['解約率高い','チャーン','離脱','継続率低い','NPS低い','満足度低い'],
  '在庫過多': ['在庫過多','在庫が多い','在庫だぶつき'],
  'リードタイム長い': ['リードタイム長い','LT長い','納期遅延','時間がかかる'],
  'データ活用不足': ['データ活用不足','データ活用できていない','可視化不足','分析不足'],
  '資源分散': ['資源分散','多角化しすぎ','手を広げすぎ','フォーカス不足'],
  'ESG': ['ESG','サステナ','脱炭素','カーボン','地域連携','社会価値'],
  '提携': ['提携','アライアンス','パートナー'],
  'M&A': ['M&A','買収','統合'],
};

/** tokens に undefined を含んでも受け入れる & 正規化 */
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

/** サブストリングにも反応する hasAny（同義語展開後のトークンで判定） */
function hasAny(
  list?: Array<string | undefined> | null,
  needles?: Array<string | undefined> | null
) {
  const a = expandTokens(list);
  const b = expandTokens(needles);
  if (!a.length || !b.length) return false;
  return b.some(n => a.some(x => x.includes(n) || n.includes(x)));
}

/** ========== レコメンド本体 ========== */
function recommendTopPatterns(signals: CompanySignals, k: number = 3): RecommendResult {
  const rules: Array<(s: CompanySignals) => Score[]> = [
    (s) => { // t1: 選択と集中
      const h:string[] = [];
      if (hasAny(s.goals, ['収益性向上','集中','不採算撤退','重点領域'])) h.push('成長/収益の集中を目指す');
      if (s.metrics?.roicLow || s.metrics?.marginLow) h.push('ROIC/利益率が低い');
      if (hasAny(s.pains, ['多角化しすぎ','資源分散'])) h.push('資源分散の痛み');
      return [{ id:'t1', score: 2 * h.length, why: h }];
    },
    (s) => { // t2: グローバル化
      const h:string[] = [];
      if (hasAny(s.goals, ['海外売上','グローバル'])) h.push('海外成長を明示');
      if (s.metrics?.overseasRatioLow) h.push('海外売上比率が低い');
      if (hasAny(s.swot?.opportunities, ['海外需要','新興国'])) h.push('外部機会：海外');
      return [{ id:'t2', score: 3 * h.length, why: h }];
    },
    (s) => { // t3: デジタル化
      const h:string[] = [];
      if (hasAny(s.pains, ['データ活用不足','属人化','手作業','サイクルタイムが長い'])) h.push('業務非効率/属人化');
      if (hasAny(s.goals, ['DX','デジタル化','自動化'])) h.push('DXを明示');
      return [{ id:'t3', score: 2.5 * h.length, why: h }];
    },
    (s) => { // t4: 顧客起点
      const h:string[] = [];
      if (hasAny(s.pains, ['解約率高い','NPS低い','顧客不満'])) h.push('顧客満足/解約の痛み');
      if (hasAny(s.goals, ['顧客価値','LTV','CX'])) h.push('顧客価値を高めたい');
      return [{ id:'t4', score: 2.5 * h.length, why: h }];
    },
    (s) => { // t5: プラットフォーム
      const h:string[] = [];
      if (hasAny(s.goals, ['エコシステム','API','マーケットプレイス'])) h.push('エコシステム志向');
      if (hasAny([s.industry], ['marketplace','platform'])) h.push('業態適性');
      return [{ id:'t5', score: 2 * h.length, why: h }];
    },
    (s) => { // t6: 垂直統合
      const h:string[] = [];
      if (hasAny(s.pains, ['品質ばらつき','外注コスト高','納期遅延'])) h.push('品質/納期/コスト課題');
      if (hasAny([s.industry], ['manufacturing'])) h.push('製造業で親和');
      return [{ id:'t6', score: 2.2 * h.length, why: h }];
    },
    (s) => { // t7: M&A/アライアンス
      const h:string[] = [];
      if (hasAny(s.initiatives, ['M&A','提携'])) h.push('M&A/提携を検討中');
      if (hasAny(s.goals, ['スピード獲得','ケイパビ買収'])) h.push('スピード/能力補完');
      return [{ id:'t7', score: 2 * h.length, why: h }];
    },
    (s) => { // t8: サプライチェーン再設計
      const h:string[] = [];
      if (s.risk?.supplyRiskHigh || s.risk?.geoRiskHigh) h.push('供給/地政学リスクが高い');
      if (hasAny(s.pains, ['在庫過多','リードタイム長い','欠品'])) h.push('在庫/LT/欠品問題');
      return [{ id:'t8', score: 3 * h.length, why: h }];
    },
    (s) => { // t9: 共有価値
      const h:string[] = [];
      if (hasAny(s.goals, ['脱炭素','ESG','地域連携'])) h.push('社会価値を戦略化');
      return [{ id:'t9', score: 1.8 * h.length, why: h }];
    },
    (s) => { // t10: 財務規律
      const h:string[] = [];
      if (s.metrics?.roicLow || s.metrics?.marginLow) h.push('資本効率/利益率の改善が急務');
      if (hasAny(s.goals, ['キャッシュフロー改善','資本効率'])) h.push('FCF/ROIC志向');
      return [{ id:'t10', score: 2.4 * h.length, why: h }];
    },
  ];

  // スコア集計
  const map = new Map<PatternId, Score>();
  for (const rule of rules) {
    for (const sc of rule(signals)) {
      const prev = map.get(sc.id) || { id: sc.id, score: 0, why: [] as string[] };
      map.set(sc.id, { id: sc.id, score: prev.score + sc.score, why: prev.why.concat(sc.why) });
    }
  }

  // 業種バイアス + 同点安定化（ID昇順でタイブレーク）
  const bias = (id: PatternId) => {
    if (signals.industry === 'manufacturing' && (id === 't6' || id === 't8')) return 0.2;
    if (signals.industry === 'retail' && (id === 't3' || id === 't4')) return 0.1;
    return 0;
  };

  const ranked = Array.from(map.values())
    .map(v => ({ ...v, score: v.score + bias(v.id) }))
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));

  const chooseK = Math.max(2, Math.min(3, Number.isFinite(k) ? k : 3));
  const topK = ranked.slice(0, chooseK);

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
    const k = body?.k ?? 3;
    const res = recommendTopPatterns(signals, k);
    return NextResponse.json(res, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'server_error', detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
