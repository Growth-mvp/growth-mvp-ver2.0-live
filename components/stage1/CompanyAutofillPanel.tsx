'use client';

import { useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { supabase } from '@/utils/supabase/client';
import {
  PROFILE_FIELD_LABEL,
  planApply,
  type CompanyProfileCandidate,
  type CurrentProfile,
  type ProfileFieldKey,
} from '@/lib/autofill/companyCandidates';

type DocumentMatch = { docId: string; docTypeCode: string | null; filerName: string; periodEnd: string | null; docDescription: string | null };
type Fetched = { companyId: string; strategyId: string; candidate: CompanyProfileCandidate | null; matches: DocumentMatch[]; fetchedAt: string };

const KEYS: ProfileFieldKey[] = ['companyName', 'ticker', 'fiscalYearEnd', 'isListed'];
const ERROR_TEXT: Record<string, string> = {
  autofill_disabled: 'この機能は停止されています',
  unauthorized: 'ログインが必要です',
  forbidden: 'この会社の入力を行う権限がありません',
  insufficient_role: '管理者または管理職のみ実行できます',
  strategy_mismatch: '戦略と企業が一致しません。画面を再読み込みしてください',
  edinet_not_configured: '公開資料の取得が設定されていません（管理者に確認してください）',
  edinet_unavailable: '公開資料の取得に失敗しました。時間をおいて再度お試しください',
  invalid_range: '期間の指定が正しくありません（31日以内で指定してください）',
};

function todayMinus(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function currentOf(state: ReturnType<typeof useStrategyStore.getState>): CurrentProfile {
  const s = state as unknown as Record<string, unknown>;
  return {
    companyName: String(s.companyName ?? ''),
    ticker: String(s.ticker ?? ''),
    fiscalYearEnd: String(s.fiscalYearEnd ?? ''),
    isListed: s.isListed === true ? true : (s.isListed as boolean | undefined),
  };
}

export default function CompanyAutofillPanel({ disabled }: { disabled?: boolean }) {
  const companyId = useStrategyStore((s) => s.companyId ?? null);
  const strategyId = useStrategyStore((s) => s.strategyId ?? null);
  const storedName = useStrategyStore((s) => s.companyName ?? '');
  const storedTicker = useStrategyStore((s) => s.ticker ?? '');
  const storedFiscalEnd = useStrategyStore((s) => s.fiscalYearEnd ?? '');
  const storedListed = useStrategyStore((s) => s.isListed);
  const current = useMemo<CurrentProfile>(
    () => ({ companyName: storedName, ticker: storedTicker, fiscalYearEnd: String(storedFiscalEnd), isListed: storedListed }),
    [storedName, storedTicker, storedFiscalEnd, storedListed],
  );
  const [secCode, setSecCode] = useState('');
  const [fromDate, setFromDate] = useState(() => todayMinus(30));
  const [toDate, setToDate] = useState(() => todayMinus(0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [selected, setSelected] = useState<ProfileFieldKey[]>([]);
  const [overwrite, setOverwrite] = useState<ProfileFieldKey[]>([]);
  const [result, setResult] = useState<string | null>(null);

  const filled = useMemo(
    () => (key: ProfileFieldKey) => (key === 'isListed' ? current.isListed === true : current[key].trim() !== ''),
    [current],
  );

  if (process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED === 'true') return null;

  const fetchCandidates = async () => {
    setError(null);
    setResult(null);
    if (!companyId || !strategyId) {
      setError('企業の情報を読み込んでから、もう一度お試しください');
      return;
    }
    if (!/^\d{4}$/.test(secCode.trim())) {
      setError('証券コード（4桁）を入力してください');
      return;
    }
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token ?? null;
      if (!token) throw new Error('unauthorized');
      const res = await fetch('/api/stage1/autofill/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId, strategyId, secCode: secCode.trim(), fromDate, toDate }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string } & Partial<Fetched>;
      if (!res.ok) {
        setError(ERROR_TEXT[json.error ?? ''] ?? '取得できませんでした');
        setFetched(null);
        return;
      }
      const f: Fetched = {
        companyId: json.companyId ?? companyId,
        strategyId: json.strategyId ?? strategyId,
        candidate: json.candidate ?? null,
        matches: json.matches ?? [],
        fetchedAt: json.fetchedAt ?? '',
      };
      setFetched(f);
      if (f.candidate) {
        const fields = KEYS.filter((k) => f.candidate?.fields[k]);
        setSelected(fields.filter((k) => !filled(k)));
        setOverwrite([]);
      } else {
        setSelected([]);
        setOverwrite([]);
      }
    } catch {
      setError('公開資料の取得に失敗しました');
      setFetched(null);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!fetched?.candidate) return;
    const now = useStrategyStore.getState();
    const nowCompany = now.companyId ?? null;
    const nowStrategy = now.strategyId ?? null;
    if (nowCompany !== fetched.companyId || nowStrategy !== fetched.strategyId) {
      setError('企業が切り替わったため、反映しません。候補を取得し直してください');
      setFetched(null);
      return;
    }
    const plan = planApply({ current: currentOf(now), candidate: fetched.candidate, selected, overwrite });
    if (plan.applied.length > 0) {
      now.setProfile(plan.patch as Parameters<typeof now.setProfile>[0]);
    }
    const applied = plan.applied.map((k) => PROFILE_FIELD_LABEL[k]).join('、') || 'なし';
    const notApplied = plan.skipped.map((s) => `${PROFILE_FIELD_LABEL[s.key]}（${s.reason === 'already_filled' ? '入力済み' : '候補なし'}）`).join('、');
    const missing = KEYS.filter((k) => !fetched.candidate?.fields[k]).map((k) => PROFILE_FIELD_LABEL[k]).join('、');
    setResult(
      [`反映：${applied}`, notApplied ? `反映せず：${notApplied}` : '', missing ? `取得できず未入力のまま：${missing}` : ''].filter(Boolean).join('　'),
    );
    setFetched(null);
    setSelected([]);
    setOverwrite([]);
  };

  const toggle = (list: ProfileFieldKey[], setList: (v: ProfileFieldKey[]) => void, key: ProfileFieldKey) =>
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  return (
    <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 text-sm">
      <div className="font-medium text-slate-800">公開資料から基本情報を候補として取得（証券コード）</div>
      <p className="text-xs text-slate-600">
        EDINETの提出書類から、会社名・証券コード・決算月の候補を作ります。承認するまで入力欄は変わりません。連結・単体は書類から確認できないため「未確認」です。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          証券コード
          <input className="ml-1 w-24 rounded border px-2 py-1" value={secCode} onChange={(e) => setSecCode(e.target.value)} disabled={disabled || busy} inputMode="numeric" maxLength={4} />
        </label>
        <label className="text-xs">
          提出日（開始）
          <input type="date" className="ml-1 rounded border px-2 py-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={disabled || busy} />
        </label>
        <label className="text-xs">
          提出日（終了）
          <input type="date" className="ml-1 rounded border px-2 py-1" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={disabled || busy} />
        </label>
        <button type="button" className="rounded border bg-white px-3 py-1 text-xs" onClick={fetchCandidates} disabled={disabled || busy}>
          {busy ? '取得中…' : '候補を取得'}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">期間は31日以内。有価証券報告書は決算後の提出日を指定してください。</p>

      {error ? <div role="alert" className="text-xs text-rose-700">{error}</div> : null}

      {fetched ? (
        <div className="space-y-2 rounded border bg-white p-2">
          {fetched.matches.length > 0 ? (
            <div className="text-xs text-slate-600">
              見つかった書類：{fetched.matches.map((m) => `${m.filerName}（${m.docDescription ?? m.docTypeCode ?? '書類'}／期末 ${m.periodEnd ?? '未確認'}）`).join('、')}
            </div>
          ) : (
            <div className="text-xs text-slate-600">この期間に、該当する証券コードの書類は見つかりませんでした。</div>
          )}
          {fetched.candidate ? (
            <>
              <ul className="space-y-1 text-xs">
                {KEYS.filter((k) => fetched.candidate?.fields[k]).map((k) => {
                  const field = fetched.candidate!.fields[k]!;
                  const shown = k === 'isListed' ? '上場' : String(field.value);
                  return (
                    <li key={k} className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={selected.includes(k)} onChange={() => toggle(selected, setSelected, k)} />
                        <span className="font-medium">{PROFILE_FIELD_LABEL[k]}</span>：{shown}
                      </label>
                      <span className="text-slate-500">
                        出典 EDINET {field.source.docId}／期末 {field.source.periodEnd ?? '未確認'}／連結・単体 未確認
                      </span>
                      {filled(k) ? (
                        <label className="flex items-center gap-1 text-amber-700">
                          <input type="checkbox" checked={overwrite.includes(k)} onChange={() => toggle(overwrite, setOverwrite, k)} />
                          入力済みの値を上書きする
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {fetched.candidate.issues.length > 0 ? (
                <ul className="list-disc pl-5 text-[11px] text-slate-600">
                  {fetched.candidate.issues.map((t) => <li key={t}>{t}</li>)}
                </ul>
              ) : null}
              <div className="flex gap-2">
                <button type="button" className="rounded bg-sky-700 px-3 py-1 text-xs text-white disabled:opacity-50" onClick={apply} disabled={disabled || selected.length === 0}>
                  承認して反映
                </button>
                <button type="button" className="rounded border px-3 py-1 text-xs" onClick={() => setFetched(null)}>
                  取り消す
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {result ? <div className="text-xs text-emerald-800">{result}</div> : null}
    </div>
  );
}
