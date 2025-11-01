// /components/steps/Step2SWOT.tsx
'use client';

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import StepLayout from '@/components/StepLayout';
import { getIndustryLabel } from '@/utils/industryTemplates';
import { saveStrategyData as saveStrategyDataApi } from '@/utils/supabase/strategy';

/* =========================
 * 共通ユーティリティ
 * ======================= */
function setFieldSafe(store: any, key: string, value: any) {
  const fnName = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
  const setter = store?.[fnName];
  if (typeof setter === 'function') {
    setter(value);
  } else if (typeof (useStrategyStore as any)?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

function ArrowUpRightIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M7 17L17 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 7H17V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GlassCard({
  title,
  accentClass,
  children,
  hint,
}: {
  title: string;
  accentClass: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="relative rounded-2xl border border-black/10 bg-white/70 dark:bg-white/5 shadow-sm backdrop-blur-md ring-1 ring-black/5">
      <div className={`absolute inset-x-0 top-0 h-1 rounded-t-2xl ${accentClass}`} />
      <div className="p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
          <div className="h-5 w-5 text-gray-500/80">
            <ArrowUpRightIcon />
          </div>
          <span>{title}</span>
        </div>
        {hint ? <p className="mb-3 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}

/* =========================
 * O/T 解析（確実分離版）
 * ======================= */
type OTParsed = { opp: string; thr: string };

const THREAT_WORDS = [
  '脅威','競争','価格','コスト','原材料','為替','景気','不況','低迷','縮小','不足','遅延','規制','関税','罰則',
  '人材不足','離職','流出','模倣','訴訟','サイバー','セキュリティ','地政学','災害','不確実','不安定','インフレ','デフレ','金利','リスク','顧客離れ',
  '需要減','値下げ圧力','原価上昇','納期','品質問題','クレーム','情報漏えい','個人情報','障壁','停滞','先行投資負担',
  'threat','threats','risk','risks','competition','price','regulation','tariff','lawsuit','inflation','recession','shortage','delay','security','cyber','geopolitical'
];

function normalize(raw: string): string {
  return raw
    .replace(/```(?:json|md|markdown)?/gi, '')
    .replace(/[：]+/g, ':')
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function stripLabel(s: string): string {
  return s
    .replace(/^\s*(?:[#■【\[]?\s*(?:Opportunit(?:y|ies)|機会|Threats?|脅威)\s*[\]】]?)\s*:?\s*/i, '')
    .trim();
}

function toText(v: any): string {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join('\n');
  if (typeof v === 'string') return v.trim();
  return '';
}

function tryMarkdownTable(text: string): OTParsed | null {
  const lines = text.split('\n').map(l => l.trim());
  if (lines.length < 2) return null;

  const headerIdx = lines.findIndex(l => /^\|/.test(l) && /機会|opportunit(?:y|ies)/i.test(l) && /脅威|threats?/i.test(l));
  if (headerIdx === -1) return null;

  const headerCols = lines[headerIdx].split('|').map(c => c.trim().toLowerCase());
  if (headerCols.length < 3) return null;

  const oppIdx = headerCols.findIndex(c => /(機会|opportunit(?:y|ies))/i.test(c));
  const thrIdx = headerCols.findIndex(c => /(脅威|threats?)/i.test(c));
  if (oppIdx === -1 || thrIdx === -1) return null;

  let i = headerIdx + 1;
  if (i < lines.length && /^\|/.test(lines[i]) && /-/.test(lines[i])) i++;

  const oppRows: string[] = [];
  const thrRows: string[] = [];
  for (; i < lines.length; i++) {
    const row = lines[i];
    if (!/^\|/.test(row)) break;
    const cols = row.split('|').map(c => c.trim());
    const opp = cols[oppIdx] ?? '';
    const thr = cols[thrIdx] ?? '';
    if (opp) oppRows.push(opp);
    if (thr) thrRows.push(thr);
  }
  const opp = oppRows.join('\n').trim();
  const thr = thrRows.join('\n').trim();
  if (opp || thr) return { opp, thr };
  return null;
}

function tryJSON(text: string): OTParsed | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    const lower: Record<string, any> = {};
    for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];

    const opp = toText(lower['opportunity'] ?? lower['opportunities'] ?? lower['機会']);
    const thr = toText(lower['threat'] ?? lower['threats'] ?? lower['脅威']);
    if (opp || thr) return { opp, thr };
  } catch {}
  return null;
}

function tryHeadings(text: string): OTParsed | null {
  const reOpp = /(?:^|\n)\s*(?:[#■【\[]?\s*(?:Opportunit(?:y|ies)|機会)\s*[\]】]?)\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:[#■【\[]?\s*(?:Threats?|脅威)\s*[\]】]?)\s*:?\s*\n|$)/i;
  const reThr = /(?:^|\n)\s*(?:[#■【\[]?\s*(?:Threats?|脅威)\s*[\]】]?)\s*:?\s*\n([\s\S]*?)$/i;
  const opp = (text.match(reOpp)?.[1] ?? '').trim();
  const thr = (text.match(reThr)?.[1] ?? '').trim();
  if (opp || thr) return { opp, thr };
  return null;
}

function tryInline(text: string): OTParsed | null {
  const reOpp = /(Opportunit(?:y|ies)|機会)\s*:\s*([\s\S]*?)(?=(?:\n{2,}|[/／｜\|]|$|\n\s*(?:Threats?|脅威)\s*:))/i;
  const reThr = /(Threats?|脅威)\s*:\s*([\s\S]*)/i;
  const m1 = text.match(reOpp);
  const after = m1 ? text.slice(m1.index! + m1[0].length) : text;
  const m2 = after.match(reThr) || text.match(reThr);
  const opp = (m1?.[2] ?? '').trim();
  const thr = (m2?.[2] ?? '').trim();
  if (opp || thr) return { opp, thr };
  return null;
}

function tryScan(text: string): OTParsed | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let mode: 'opp' | 'thr' | null = null;
  const oppL: string[] = [];
  const thrL: string[] = [];

  const isOpp = (l: string) => /(Opportunit(?:y|ies)|機会)\s*:?\s*$/i.test(l.replace(/[【】\[\]]/g, ''));
  const isThr = (l: string) => /(Threats?|脅威)\s*:?\s*$/i.test(l.replace(/[【】\[\]]/g, ''));

  for (const raw of lines) {
    const l = raw;
    if (isOpp(l) || /^\[?O\]?[:：]/i.test(l)) { mode = 'opp'; continue; }
    if (isThr(l) || /^\[?T\]?[:：]/i.test(l)) { mode = 'thr'; continue; }

    if (/^\[?O\]?[:：]/i.test(l)) { oppL.push(stripLabel(l)); continue; }
    if (/^\[?T\]?[:：]/i.test(l)) { thrL.push(stripLabel(l)); continue; }

    if (mode === 'opp') oppL.push(stripLabel(l));
    else if (mode === 'thr') thrL.push(stripLabel(l));
  }

  const opp = oppL.join('\n').trim();
  const thr = thrL.join('\n').trim();
  if (opp || thr) return { opp, thr };
  return null;
}

function forceSplit(text: string): OTParsed {
  const idxThr = text.search(/(?:^|\n)\s*(?:[#■【\[]?\s*(?:Threats?|脅威)\s*[\]】]?)\s*:?/i);
  if (idxThr > -1) {
    const left = text.slice(0, idxThr);
    const right = text.slice(idxThr);
    const opp = stripLabel(left).trim();
    const thr = stripLabel(right.replace(/^(?:[#■【\[]?\s*(?:Threats?|脅威)\s*[\]】]?)\s*:?\s*/i, '')).trim();
    return { opp, thr };
  }
  const idxOpp = text.search(/(?:^|\n)\s*(?:[#■【\[]?\s*(?:Opportunit(?:y|ies)|機会)\s*[\]】]?)\s*:?/i);
  if (idxOpp > -1 && idxOpp > 0) {
    const left = text.slice(0, idxOpp);
    const right = text.slice(idxOpp);
    const thr = stripLabel(left).trim();
    const opp = stripLabel(right.replace(/^(?:[#■【\[]?\s*(?:Opportunit(?:y|ies)|機会)\s*[\]】]?)\s*:?\s*/i, '')).trim();
    return { opp, thr };
  }
  return { opp: '', thr: '' };
}

function classifyFallback(text: string): OTParsed {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const oppL: string[] = [];
  const thrL: string[] = [];
  for (let l of lines) {
    const lower = l.toLowerCase();
    const hitThreat =
      THREAT_WORDS.some((kw) => lower.includes(kw)) ||
      /(不|難|低迷|下落|減少|弱|課題|懸念|阻害|障害|問題)/.test(l);
    if (/(?:機会|opportunit(?:y|ies))/i.test(l) && /(脅威|threat)/i.test(l)) {
      const idx = l.search(/(脅威|threat)/i);
      const left = l.slice(0, idx).replace(/(機会|opportunit(?:y|ies))[:：]?\s*/i, '').trim();
      const right = l.slice(idx).replace(/(脅威|threats?)[:：]?\s*/i, '').trim();
      if (left) oppL.push(left);
      if (right) thrL.push(right);
      continue;
    }
    if (/(?:機会|opportunit(?:y|ies))/i.test(l)) { oppL.push(l.replace(/(機会|opportunit(?:y|ies))[:：]?\s*/i, '').trim()); continue; }
    if (/(?:脅威|threats?)/i.test(l)) { thrL.push(l.replace(/(脅威|threats?)[:：]?\s*/i, '').trim()); continue; }
    hitThreat ? thrL.push(l) : oppL.push(l);
  }
  return { opp: oppL.join('\n').trim(), thr: thrL.join('\n').trim() };
}

function parseOT(raw: string): OTParsed {
  const text = normalize(raw);

  const tbl = tryMarkdownTable(text);
  if (tbl && (tbl.opp || tbl.thr)) return tbl;

  const j = tryJSON(text);
  if (j && (j.opp || j.thr)) return j;

  const h = tryHeadings(text);
  if (h && (h.opp || h.thr)) return h;

  const inl = tryInline(text);
  if (inl && (inl.opp || inl.thr)) return inl;

  const sc = tryScan(text);
  if (sc && (sc.opp || sc.thr)) return sc;

  const fs = forceSplit(text);
  if (fs.opp || fs.thr) return fs;

  const fb = classifyFallback(text);
  if (fb.opp || fb.thr) return fb;

  return { opp: text, thr: '' };
}

/* =========================
 * コンポーネント本体（保存の安全化込み）
 * ======================= */
export default function Step2SWOT() {
  const st = useStrategyStore() as any;

  const strength: string = st?.strength ?? '';
  const weakness: string = st?.weakness ?? '';
  const opportunity: string = st?.opportunity ?? '';
  const threat: string = st?.threat ?? '';

  // 自動生成の補助情報
  const industry: string = st?.industry ?? '';
  const revenueRaw: unknown = st?.revenue ?? '';
  const employeesRaw: unknown = st?.employees ?? '';
  const businessContent: string = st?.businessContent ?? '';

  // 日本語ラベル（ヘッダ表示用）
  const industryJa = industry ? getIndustryLabel(industry, { full: true }) : '';

  // 保存の安全化（Step2Portfolio と同等のゲート/デバウンス/再試行）
  const user = useUserStore((s) => s.user);
  const companyId = useUserStore((s) => s.companyId);
  const hydrated = useUserStore((s) => (s as any).hydrated);
  const membershipLoaded = useUserStore((s) => (s as any).membershipLoaded);
  const userId = user?.id ?? null;
  const canPersist = !!userId && !!companyId && !!hydrated && !!membershipLoaded;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingGateRef = useRef(false);

  useEffect(() => {
    savingGateRef.current = canPersist;
  }, [canPersist]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async function trySave() {
      if (!savingGateRef.current || !canPersist) {
        timerRef.current = setTimeout(trySave, 600);
        return;
      }
      if (!dirtyRef.current) return;

      dirtyRef.current = false;
      setSaving(true);
      setSaveError(null);
      try {
        const state = useStrategyStore.getState() as any;
        await saveStrategyDataApi(state, userId!, companyId!);
      } catch (e: any) {
        dirtyRef.current = true;
        setSaveError(e?.message || '保存に失敗しました');
        console.error('[SWOT AUTO SAVE] failed:', e);
        timerRef.current = setTimeout(trySave, 1500);
      } finally {
        setSaving(false);
      }
    }, 700); // SWOTは入力が長文なので少し短めでもOK
  }, [canPersist, userId, companyId]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // O/T 自動生成
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const arrToText = (arr: unknown): string =>
    Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean).join('\n') : '';

  const handleGenerateOT = async () => {
    if (loading) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/generate-ot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // API には従来どおり英語コードの industry を送る（表示だけ日本語）
        body: JSON.stringify({
          industry,
          revenue: typeof revenueRaw === 'number' ? revenueRaw : String(revenueRaw ?? ''),
          employees: typeof employeesRaw === 'number' ? employeesRaw : String(employeesRaw ?? ''),
          businessContent,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`API ${res.status}`);

      const data = await res.json().catch(() => ({} as any));

      // 1) 構造化(JSON)優先
      let oppText = arrToText(data?.opportunity);
      let thrText = arrToText(data?.threat);

      // 2) 後方互換: result/text/content を文字列として解析
      const raw: unknown = data?.result ?? data?.text ?? data?.content ?? '';
      if ((!oppText && !thrText) && typeof raw === 'string' && raw.trim()) {
        const { opp, thr } = parseOT(raw);
        oppText = oppText || opp;
        thrText = thrText || thr;
      }

      if (!oppText && !thrText) {
        setLoading(false);
        return;
      }

      // 一旦空へ（差分検出のため）
      setFieldSafe(st, 'opportunity', '');
      setFieldSafe(st, 'threat', '');

      if (oppText) setFieldSafe(st, 'opportunity', oppText);
      if (thrText) setFieldSafe(st, 'threat', thrText);

      // 自動生成結果も保存トリガー
      markDirty();

    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('O/T自動生成エラー:', err);
        setError('O/Tの取得に失敗しました。時間をおいて再試行してください。');
      }
    } finally {
      setLoading(false);
    }
  };

  const headerNote = useMemo(() => {
    const rev = typeof revenueRaw === 'number' ? String(revenueRaw) : String(revenueRaw ?? '');
    const emp = typeof employeesRaw === 'number' ? String(employeesRaw) : String(employeesRaw ?? '');
    const parts = [
      industryJa && `業種：${industryJa}`,
      rev && `売上：${rev}`,
      emp && `従業員：${emp}`,
    ]
      .filter(Boolean)
      .join(' / ');
    return parts || '会社情報（業種・売上・従業員 等）を入れると精度が上がります';
  }, [industryJa, revenueRaw, employeesRaw]);

  return (
    <StepLayout step={2} totalSteps={5} title="STEP 2：SWOT分析（強み・弱み・機会・脅威）">
      {/* 接続・保存ステータス（控えめに上部へ） */}
      <div className="mb-3 text-xs text-gray-500">
        {saving ? '保存中…' : saveError ? <span className="text-red-600">保存失敗：{saveError}</span> : '保存待ち'}
      </div>

      <div className="mb-5 rounded-2xl border border-black/10 bg-white/60 shadow-sm backdrop-blur-md ring-1 ring-black/5 p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{headerNote}</div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              「機会・脅威を自動生成」を押すと、会社情報をもとにAIが提案します。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateOT}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm backdrop-blur hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-black/10"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border border-black/20 border-t-transparent" />
                  生成中…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <ArrowUpRightIcon className="h-4 w-4" />
                  機会・脅威を自動生成
                </span>
              )}
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-3 text-[13px] text-red-600" role="status" aria-live="polite">
            {error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <GlassCard
          title="Strength（強み）"
          accentClass="bg-emerald-400/80"
          hint="例：高度な技術力／顧客との信頼関係／ブランド力 など"
        >
          <textarea
            className="min-h[200px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            rows={8}
            value={st?.strength ?? strength}
            onChange={(e) => { setFieldSafe(st, 'strength', e.target.value); markDirty(); }}
            placeholder="箇条書き可（・〜）"
          />
        </GlassCard>

        <GlassCard
          title="Weakness（弱み）"
          accentClass="bg-rose-400/80"
          hint="例：人材不足／情報発信の弱さ／老朽化した設備 など"
        >
          <textarea
            className="min-h[200px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            rows={8}
            value={st?.weakness ?? weakness}
            onChange={(e) => { setFieldSafe(st, 'weakness', e.target.value); markDirty(); }}
            placeholder="箇条書き可（・〜）"
          />
        </GlassCard>

        <GlassCard
          title="Opportunity（機会）"
          accentClass="bg-sky-400/80"
          hint="例：市場拡大／規制緩和／技術革新 など"
        >
          <textarea
            className="min-h[200px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            rows={8}
            value={st?.opportunity ?? opportunity}
            onChange={(e) => { setFieldSafe(st, 'opportunity', e.target.value); markDirty(); }}
            placeholder="AI提案を基に加筆・修正してください"
          />
        </GlassCard>

        <GlassCard
          title="Threat（脅威）"
          accentClass="bg-amber-400/80"
          hint="例：価格競争の激化／景気悪化／海外勢の参入 など"
        >
          <textarea
            className="min-h[200px] w-full resize-y rounded-xl border border-black/10 bg-white/70 px-3 py-3 text-sm text-gray-800 shadow-inner placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            rows={8}
            value={st?.threat ?? threat}
            onChange={(e) => { setFieldSafe(st, 'threat', e.target.value); markDirty(); }}
            placeholder="AI提案を基に加筆・修正してください"
          />
        </GlassCard>
      </div>
    </StepLayout>
  );
}
