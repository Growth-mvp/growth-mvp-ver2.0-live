'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { supabase } from '@/utils/supabase/client';
import { useAutofillStore, type PendingAutofill } from '@/lib/autofill/autofillStore';
import { combineFinance, splitFinanceWrite } from '@/lib/autofill/financeWrite';
import {
  FINANCE_KEYS,
  FINANCE_LABEL,
  PROFILE_KEYS,
  PROFILE_LABEL,
  planFilingApply,
  type CurrentFilingProfile,
  type FilingCandidate,
  type FinanceKey,
  type ProfileKey,
} from '@/lib/autofill/filingCandidates';

type Result =
  | { status: 'FOUND'; candidate: FilingCandidate; fetchedAt: string; scannedDays: number }
  | { status: 'AMBIGUOUS'; candidates: Array<{ name: string; secCode: string | null; edinetCode: string | null }> }
  | { status: 'NOT_FOUND' | 'BUDGET_EXCEEDED' | 'QUERY_UNCLEAR'; message?: string };

const ERROR_TEXT: Record<string, string> = {
  autofill_disabled: 'この機能は停止されています',
  unauthorized: 'ログインが必要です',
  forbidden: 'この会社の入力を行う権限がありません',
  insufficient_role: '管理者または管理職のみ実行できます',
  strategy_mismatch: '戦略と企業が一致しません。画面を再読み込みしてください',
  edinet_not_configured: '公開資料の取得が設定されていません（管理者に確認してください）',
  edinet_unavailable: '公開資料の取得に失敗しました。時間をおいて再度お試しください',
  invalid_payload: '会社名または証券コード（4桁）を入力してください',
};

const STATUS_TEXT: Record<string, string> = {
  NOT_FOUND: '提出書類の中に、該当する会社の有価証券報告書が見つかりませんでした。証券コードで指定してください。',
  BUDGET_EXCEEDED: '確認する期間が多すぎるため、途中で止めました。証券コード（4桁）で指定してください。',
  QUERY_UNCLEAR: '会社名または証券コード（4桁）を入れてください。',
};

const DISPLAY_TEXT_MAX = 160;

function yen(v: number): string {
  return `${v.toLocaleString('ja-JP')}円`;
}

function fieldDisplay(key: ProfileKey, c: FilingCandidate): string {
  if (key === 'companyName') return c.profile.fields.companyName?.value ?? '';
  if (key === 'ticker') return c.profile.fields.ticker?.value ?? '';
  if (key === 'fiscalYearEnd') return c.profile.fields.fiscalYearEnd ? `${c.profile.fields.fiscalYearEnd.value}月` : '';
  if (key === 'isListed') return c.profile.fields.isListed ? '上場' : '';
  if (key === 'location') return c.profileExtra.location?.value ?? '';
  if (key === 'employees') return c.profileExtra.employees ? `${c.profileExtra.employees.value}名（連結・単体は未確認）` : '';
  const text = c.profileExtra.businessContent?.value ?? '';
  return Array.from(text).length > DISPLAY_TEXT_MAX ? `${Array.from(text).slice(0, DISPLAY_TEXT_MAX).join('')}…` : text;
}

function sourceLine(c: FilingCandidate): string {
  return `出典：EDINET ${c.docId}（${c.periodEnd ?? '期末未確認'} 締め）／連結・単体：${c.finance.length > 0 ? '連結（照合済み）' : '未確認'}／金額の単位：円`;
}

export default function CompanyAutofillPanel({ disabled }: { disabled?: boolean }) {
  const companyId = useStrategyStore((s) => s.companyId ?? null);
  const strategyId = useStrategyStore((s) => s.strategyId ?? null);
  const storedName = useStrategyStore((s) => s.companyName ?? '');
  const storedTicker = useStrategyStore((s) => s.ticker ?? '');
  const storedFiscalEnd = useStrategyStore((s) => s.fiscalYearEnd ?? '');
  const storedListed = useStrategyStore((s) => s.isListed);
  const storedLocation = useStrategyStore((s) => s.location ?? '');
  const storedEmployees = useStrategyStore((s) => s.employees ?? '');
  const storedBusiness = useStrategyStore((s) => s.businessContent ?? '');
  const financePL = useStrategyStore((s) => s.financePL);
  const financeBS = useStrategyStore((s) => s.financeBS);
  const pending = useAutofillStore((s) => s.pending);
  const setPending = useAutofillStore((s) => s.setPending);

  const current = useMemo<CurrentFilingProfile>(
    () => ({
      companyName: storedName,
      ticker: storedTicker,
      fiscalYearEnd: String(storedFiscalEnd),
      isListed: storedListed,
      location: storedLocation,
      employees: String(storedEmployees ?? ''),
      businessContent: storedBusiness,
    }),
    [storedName, storedTicker, storedFiscalEnd, storedListed, storedLocation, storedEmployees, storedBusiness],
  );

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<PendingAutofill | null>(null);
  const [profileSel, setProfileSel] = useState<ProfileKey[]>([]);
  const [profileOver, setProfileOver] = useState<ProfileKey[]>([]);
  const [yearSel, setYearSel] = useState<number[]>([]);
  const [yearOver, setYearOver] = useState<number[]>([]);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    if (pending.companyId !== companyId || pending.strategyId !== strategyId) return;
    setView(pending);
    setResult({ status: 'FOUND', candidate: pending.candidate, fetchedAt: pending.fetchedAt, scannedDays: 0 });
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, companyId, strategyId]);

  useEffect(() => {
    if (!view) return;
    const c = view.candidate;
    const available = PROFILE_KEYS.filter((k) => fieldDisplay(k, c) !== '');
    setProfileSel(available.filter((k) => !filledProfile(k, current)));
    setProfileOver([]);
    setYearSel(c.finance.map((y) => y.year).filter((y) => !hasExistingYear(y, financePL, financeBS)));
    setYearOver([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED === 'true') return null;

  const fetchCandidates = async () => {
    setError(null);
    setResult(null);
    setApplied(null);
    if (!companyId || !strategyId) {
      setError('企業の情報を読み込んでから、もう一度お試しください');
      return;
    }
    if (!text.trim()) {
      setError('会社名または証券コード（4桁）を入力してください');
      return;
    }
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token ?? null;
      if (!token) throw new Error('unauthorized');
      const res = await fetch('/api/stage1/autofill/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId, strategyId, text: text.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(ERROR_TEXT[String(json.error ?? '')] ?? '取得できませんでした');
        return;
      }
      const status = String(json.status ?? '');
      if (status === 'FOUND') {
        const candidate = json.candidate as FilingCandidate;
        const fetchedAt = String(json.fetchedAt ?? '');
        setResult({ status: 'FOUND', candidate, fetchedAt, scannedDays: Number(json.scannedDays ?? 0) });
        setView({ companyId, strategyId, fetchedAt, candidate });
      } else if (status === 'AMBIGUOUS') {
        setResult({ status: 'AMBIGUOUS', candidates: (json.candidates ?? []) as Array<{ name: string; secCode: string | null; edinetCode: string | null }> });
      } else {
        setResult({ status: (status as 'NOT_FOUND') || 'NOT_FOUND', message: String(json.message ?? '') });
      }
    } catch {
      setError('公開資料の取得に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    if (!view) return;
    const now = useStrategyStore.getState();
    if ((now.companyId ?? null) !== view.companyId || (now.strategyId ?? null) !== view.strategyId) {
      setError('企業が切り替わったため、反映しません。候補を取得し直してください');
      setView(null);
      setResult(null);
      return;
    }
    const st = useStrategyStore.getState() as unknown as { financePL: Array<Record<string, unknown> & { year: number }>; financeBS: Array<Record<string, unknown> & { year: number }> };
    const pl = st.financePL ?? [];
    const bs = st.financeBS ?? [];
    const plan = planFilingApply({
      current: {
        companyName: now.companyName ?? '',
        ticker: String(now.ticker ?? ''),
        fiscalYearEnd: String(now.fiscalYearEnd ?? ''),
        isListed: now.isListed,
        location: now.location ?? '',
        employees: String(now.employees ?? ''),
        businessContent: now.businessContent ?? '',
      },
      currentFinance: combineFinance(pl as never, bs as never),
      candidate: view.candidate,
      selectedProfile: profileSel,
      overwriteProfile: profileOver,
      selectedYears: yearSel,
      overwriteYears: yearOver,
    });

    if (Object.keys(plan.profilePatch).length > 0) {
      now.setProfile(plan.profilePatch as Parameters<typeof now.setProfile>[0]);
    }
    const written = splitFinanceWrite(plan, pl as never, bs as never);
    if (written.pl) now.setFinancePL(written.pl as never);
    if (written.bs) now.setFinanceBS(written.bs as never);

    const parts = [
      plan.profileApplied.length > 0 ? `反映：${plan.profileApplied.map((k) => PROFILE_LABEL[k]).join('、')}` : '',
      plan.financeApplied.length > 0
        ? `財務：${plan.financeApplied.map((a) => `${a.year}年度（${a.keys.map((k) => FINANCE_LABEL[k]).join('・')}）`).join('、')}`
        : '',
      plan.profileSkipped.length + plan.financeSkipped.filter((s) => s.reason === 'already_filled').length > 0
        ? '入力済みの値は変えていません（上書きを選んでいない項目）'
        : '',
      '未取得のまま（推測で補っていません）：業種、事業セグメントの名称と金額、取得できなかった年度の項目',
    ].filter(Boolean);
    setApplied(parts.join('　'));
    setView(null);
    setResult(null);
    setProfileSel([]);
    setYearSel([]);
  };

  const toggle = <T,>(list: T[], setList: (v: T[]) => void, v: T) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const candidate = view?.candidate ?? null;
  const pendingNow = pending && pending.companyId === companyId ? pending : null;

  return (
    <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 text-sm">
      <div className="font-medium text-slate-800">AIで公開資料（有価証券報告書）から基本情報を取得</div>
      <p className="text-xs text-slate-600">
        会社名または証券コード（4桁）を入れて取得します。AI経営コンサルタントに「〇〇の基本情報を入力して」と頼んでも同じ候補を作れます。候補は承認するまで入力欄を変えません。
      </p>
      {pendingNow ? <div className="text-xs text-sky-800">AI経営コンサルタントが作った候補があります。下の内容を確認して承認してください。</div> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          会社名または証券コード
          <input className="ml-1 w-56 rounded border px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled || busy} placeholder="例：日本製罐 / 5905" />
        </label>
        <button type="button" className="rounded border bg-white px-3 py-1 text-xs" onClick={fetchCandidates} disabled={disabled || busy}>
          {busy ? '取得中…（公開資料を確認しています）' : '候補を取得'}
        </button>
      </div>

      {error ? <div role="alert" className="text-xs text-rose-700">{error}</div> : null}

      {result?.status === 'AMBIGUOUS' ? (
        <div className="rounded border bg-white p-2 text-xs">
          同じ名前の会社が複数あります。証券コード（4桁）で指定してください：
          <ul className="list-disc pl-5">
            {result.candidates.map((c) => (
              <li key={`${c.edinetCode}-${c.name}`}>{c.name}（証券コード {c.secCode ?? '未確認'}／EDINET {c.edinetCode ?? '未確認'}）</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result && (result.status === 'NOT_FOUND' || result.status === 'BUDGET_EXCEEDED' || result.status === 'QUERY_UNCLEAR') ? (
        <div className="text-xs text-slate-700">{STATUS_TEXT[result.status]}</div>
      ) : null}

      {candidate && view ? (
        <div className="space-y-3 rounded border bg-white p-2">
          <div className="text-xs text-slate-700">
            取得元：{candidate.filer.name}（EDINET {candidate.filer.edinetCode ?? '未確認'}）／{candidate.docTypeCode === '130' ? '訂正有価証券報告書' : '有価証券報告書'}
            {candidate.amendedFromDocId ? `（元の書類 ${candidate.amendedFromDocId} より後の訂正）` : ''}
          </div>
          <div className="text-[11px] text-slate-500">{sourceLine(candidate)}</div>

          <div className="font-medium text-xs">企業情報</div>
          <ul className="space-y-1 text-xs">
            {PROFILE_KEYS.filter((k) => fieldDisplay(k, candidate) !== '').map((k) => {
              const filled = filledProfile(k, current);
              return (
                <li key={k} className="flex flex-wrap items-start gap-2">
                  <label className="flex items-start gap-1">
                    <input type="checkbox" className="mt-0.5" checked={profileSel.includes(k)} onChange={() => toggle(profileSel, setProfileSel, k)} disabled={disabled} />
                    <span className="font-medium">{PROFILE_LABEL[k]}</span>：<span className="break-all">{fieldDisplay(k, candidate)}</span>
                  </label>
                  {filled ? (
                    <label className="flex items-center gap-1 text-amber-700">
                      <input type="checkbox" checked={profileOver.includes(k)} onChange={() => toggle(profileOver, setProfileOver, k)} disabled={disabled} />
                      入力済みの値を上書きする
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {candidate.finance.length > 0 ? (
            <>
              <div className="font-medium text-xs">財務（単位：円）</div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pr-2">年度</th>
                    {FINANCE_KEYS.map((k) => <th key={k} className="pr-2">{FINANCE_LABEL[k]}</th>)}
                    <th>反映</th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.finance.map((y) => {
                    const hasExisting = (financePL ?? []).some((r) => r.year === y.year) || (financeBS ?? []).some((r) => r.year === y.year);
                    return (
                      <tr key={y.year} className="align-top">
                        <td className="pr-2 font-medium">{y.year}年度</td>
                        {FINANCE_KEYS.map((k) => (
                          <td key={k} className="pr-2">{y[k] ? yen(y[k]!.value) : <span className="text-slate-400">未取得</span>}</td>
                        ))}
                        <td>
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={yearSel.includes(y.year)} onChange={() => toggle(yearSel, setYearSel, y.year)} disabled={disabled} />
                            選ぶ
                          </label>
                          {hasExisting ? (
                            <label className="flex items-center gap-1 text-amber-700">
                              <input type="checkbox" checked={yearOver.includes(y.year)} onChange={() => toggle(yearOver, setYearOver, y.year)} disabled={disabled} />
                              上書き
                            </label>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}

          {candidate.issues.length > 0 ? (
            <ul className="list-disc pl-5 text-[11px] text-slate-600">
              {candidate.issues.map((t) => <li key={t}>{t}</li>)}
            </ul>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-sky-700 px-3 py-1 text-xs text-white disabled:opacity-50"
              onClick={approve}
              disabled={disabled || (profileSel.length === 0 && yearSel.length === 0)}
            >
              承認して反映
            </button>
            <button type="button" className="rounded border px-3 py-1 text-xs" onClick={() => { setView(null); setResult(null); }}>
              取り消す
            </button>
          </div>
        </div>
      ) : null}

      {applied ? <div className="text-xs text-emerald-800">{applied}</div> : null}
    </div>
  );
}

function filledProfile(k: ProfileKey, c: CurrentFilingProfile): boolean {
  if (k === 'isListed') return c.isListed === true;
  const v = c[k];
  return typeof v === 'string' ? v.trim() !== '' : v !== undefined;
}

function hasExistingYear(year: number, pl: ReadonlyArray<{ year: number }> | null | undefined, bs: ReadonlyArray<{ year: number }> | null | undefined): boolean {
  return (pl ?? []).some((r) => r.year === year) || (bs ?? []).some((r) => r.year === year);
}
