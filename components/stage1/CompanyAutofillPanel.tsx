'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { supabase } from '@/utils/supabase/client';
import { getIndustryLabel } from '@/utils/industryTemplates';
import { useAutofillStore, type PendingAutofill } from '@/lib/autofill/autofillStore';
import { combineFinance, splitFinanceWrite } from '@/lib/autofill/financeWrite';
import { runAutofillPipeline, type IdentifyCandidate, type PipelineProgress, type PipelineResult } from '@/lib/autofill/client';
import { normalizeCompanyName } from '@/lib/autofill/edinetIdentify';
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

const ERROR_TEXT: Record<string, string> = {
  autofill_disabled: 'この機能は停止されています',
  unauthorized: 'ログインが必要です',
  forbidden: 'この会社の入力を行う権限がありません',
  insufficient_role: '管理者または管理職のみ実行できます',
  strategy_mismatch: '戦略と企業が一致しません。画面を再読み込みしてください',
  edinet_not_configured: '公開資料の取得が設定されていません（管理者に確認してください）',
  edinet_unavailable: '公開資料の取得に失敗しました。時間をおいて再度お試しください',
  codelist_unavailable: 'EDINETコードリストを取得できませんでした。時間をおいて再度お試しください',
  invalid_payload: '会社名または証券コード（4桁）を入力してください',
};

const DISPLAY_TEXT_MAX = 160;
const yen = (v: number) => `${v.toLocaleString('ja-JP')}円`;
const million = (v: number | undefined) => (v === undefined ? '未取得' : `${Math.round(v / 1_000_000).toLocaleString('ja-JP')}百万円`);

function fieldDisplay(key: ProfileKey, c: FilingCandidate): string {
  if (key === 'companyName') return c.profile.fields.companyName?.value ?? '';
  if (key === 'ticker') return c.profile.fields.ticker?.value ?? '';
  if (key === 'fiscalYearEnd') return c.profile.fields.fiscalYearEnd ? `${c.profile.fields.fiscalYearEnd.value}月` : '';
  if (key === 'isListed') return c.profile.fields.isListed ? '上場' : '';
  if (key === 'location') return c.profileExtra.location?.value ?? '';
  if (key === 'employees') return c.profileExtra.employees ? `${c.profileExtra.employees.value}名（連結・単体は未確認）` : '';
  if (key === 'industry') {
    const v = c.profileExtra.industry?.value;
    return v ? getIndustryLabel(v, { full: true }) : '';
  }
  const text = c.profileExtra.businessContent?.value ?? '';
  return Array.from(text).length > DISPLAY_TEXT_MAX ? `${Array.from(text).slice(0, DISPLAY_TEXT_MAX).join('')}…` : text;
}

function filledProfile(k: ProfileKey, c: CurrentFilingProfile): boolean {
  if (k === 'isListed') return c.isListed === true;
  const v = c[k];
  return typeof v === 'string' ? v.trim() !== '' : v !== undefined;
}

function hasExistingYear(year: number, pl: ReadonlyArray<{ year: number }> | null | undefined, bs: ReadonlyArray<{ year: number }> | null | undefined): boolean {
  return (pl ?? []).some((r) => r.year === year) || (bs ?? []).some((r) => r.year === year);
}

/** 登録中の企業と取得対象の企業が違うか（取り違え防止）。登録中の情報が空なら違いとはしない */
export function differsFromRegistered(registeredName: string, registeredTicker: string, candidate: FilingCandidate): boolean {
  const nameDiffers = registeredName.trim() !== '' && normalizeCompanyName(registeredName) !== normalizeCompanyName(candidate.filer.name);
  const tickerDiffers = registeredTicker.trim() !== '' && candidate.filer.secCode !== null && registeredTicker.trim() !== candidate.filer.secCode;
  return nameDiffers || tickerDiffers;
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
  const storedIndustry = useStrategyStore((s) => s.industry ?? '');
  const storedSegments = useStrategyStore((s) => s.businessSegments ?? []);
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
      industry: storedIndustry,
    }),
    [storedName, storedTicker, storedFiscalEnd, storedListed, storedLocation, storedEmployees, storedBusiness, storedIndustry],
  );

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<IdentifyCandidate[] | null>(null);
  const [view, setView] = useState<PendingAutofill | null>(null);
  const [profileSel, setProfileSel] = useState<ProfileKey[]>([]);
  const [profileOver, setProfileOver] = useState<ProfileKey[]>([]);
  const [yearSel, setYearSel] = useState<number[]>([]);
  const [yearOver, setYearOver] = useState<number[]>([]);
  const [segmentSel, setSegmentSel] = useState(false);
  const [otherCompanyOk, setOtherCompanyOk] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    if (pending.companyId !== companyId || pending.strategyId !== strategyId) return;
    setView(pending);
    setNotice('AI経営コンサルタントが作った候補です。内容を確認して承認してください。');
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, companyId, strategyId]);

  useEffect(() => {
    if (!view) return;
    const c = view.candidate;
    setProfileSel(PROFILE_KEYS.filter((k) => fieldDisplay(k, c) !== '' && !filledProfile(k, current)));
    setProfileOver([]);
    setYearSel(c.finance.map((y) => y.year).filter((y) => !hasExistingYear(y, financePL, financeBS)));
    setYearOver([]);
    setSegmentSel((c.segments?.items.length ?? 0) > 0 && storedSegments.length === 0);
    setOtherCompanyOk(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED === 'true') return null;

  const fetchCandidates = async () => {
    setError(null);
    setNotice(null);
    setApplied(null);
    setAmbiguous(null);
    setView(null);
    if (!companyId || !strategyId) {
      setError('企業の情報を読み込んでから、もう一度お試しください');
      return;
    }
    if (!text.trim()) {
      setError('会社名または証券コード（4桁）を入力してください');
      return;
    }
    setBusy(true);
    setProgress({ step: 0, total: 1, label: '準備しています' });
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token ?? null;
      if (!token) throw new Error('unauthorized');
      const result: PipelineResult = await runAutofillPipeline({
        text: text.trim(),
        companyId,
        strategyId,
        token,
        onProgress: setProgress,
      });
      if (result.status === 'FOUND') {
        setView({ companyId, strategyId, fetchedAt: result.fetchedAt, candidate: result.candidate });
        setNotice(result.missingPeriods.length > 0 ? `取得できなかった決算期：${result.missingPeriods.join('、')}` : null);
      } else if (result.status === 'AMBIGUOUS') {
        setAmbiguous(result.candidates);
      } else {
        setNotice(result.message);
      }
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(ERROR_TEXT[code] ?? '公開資料の取得に失敗しました。時間をおいて再度お試しください');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const approve = () => {
    if (!view) return;
    const now = useStrategyStore.getState();
    if ((now.companyId ?? null) !== view.companyId || (now.strategyId ?? null) !== view.strategyId) {
      setError('企業が切り替わったため、反映しません。候補を取得し直してください');
      setView(null);
      return;
    }
    const st = now as unknown as { financePL: Array<Record<string, unknown> & { year: number }>; financeBS: Array<Record<string, unknown> & { year: number }> };
    const pl = st.financePL ?? [];
    const bs = st.financeBS ?? [];
    const candidate = view.candidate;
    const plan = planFilingApply({
      current: {
        companyName: now.companyName ?? '',
        ticker: String(now.ticker ?? ''),
        fiscalYearEnd: String(now.fiscalYearEnd ?? ''),
        isListed: now.isListed,
        location: now.location ?? '',
        employees: String(now.employees ?? ''),
        businessContent: now.businessContent ?? '',
        industry: now.industry ?? '',
      },
      currentFinance: combineFinance(pl as never, bs as never),
      candidate,
      selectedProfile: profileSel,
      overwriteProfile: profileOver,
      selectedYears: yearSel,
      overwriteYears: yearOver,
      selectedSegments: segmentSel,
      overwriteSegments: false,
      currentSegmentCount: (now.businessSegments ?? []).length,
    });

    const profileWrite: Record<string, unknown> = { ...plan.profilePatch };
    if (plan.segmentsPatch) {
      profileWrite.businessSegments = plan.segmentsPatch.map((s) => ({
        id: crypto.randomUUID(),
        name: s.name,
        revenue: s.revenueMillion,
        profit: s.profitMillion,
      }));
    }
    if (Object.keys(profileWrite).length > 0) now.setProfile(profileWrite as Parameters<typeof now.setProfile>[0]);
    const written = splitFinanceWrite(plan, pl as never, bs as never);
    if (written.pl) now.setFinancePL(written.pl as never);
    if (written.bs) now.setFinanceBS(written.bs as never);

    const parts = [
      plan.profileApplied.length > 0 ? `反映：${plan.profileApplied.map((k) => PROFILE_LABEL[k]).join('、')}` : '',
      plan.segmentsPatch ? `事業セグメント：${plan.segmentsPatch.length}件` : '',
      plan.financeApplied.length > 0
        ? `財務：${plan.financeApplied.map((a) => `${a.year}年度`).join('、')}`
        : '',
      '未取得のまま（推測で補っていません）：取得できなかった項目と年度',
    ].filter(Boolean);
    setApplied(parts.join('　'));
    setView(null);
    setProfileSel([]);
    setYearSel([]);
    setSegmentSel(false);
  };

  const toggle = <T,>(list: T[], setList: (v: T[]) => void, v: T) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const candidate = view?.candidate ?? null;
  const mismatch = candidate ? differsFromRegistered(storedName, storedTicker, candidate) : false;
  const pct = progress && progress.total > 0 ? Math.round((progress.step / progress.total) * 100) : 0;

  return (
    <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 text-sm">
      <div className="font-medium text-slate-800">AIで公開資料（有価証券報告書）から基本情報を取得</div>
      <p className="text-xs text-slate-600">
        会社名または証券コード（4桁）を入れて取得します。AI経営コンサルタントに「〇〇の基本情報を入力して」と頼んでも同じ候補を作れます。承認するまで入力欄は変わりません。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          会社名または証券コード
          <input className="ml-1 w-56 rounded border px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled || busy} placeholder="例：日本製罐 / 5905" />
        </label>
        <button type="button" className="rounded border bg-white px-3 py-1 text-xs" onClick={fetchCandidates} disabled={disabled || busy}>
          {busy ? '取得中…' : '候補を取得'}
        </button>
      </div>

      {busy && progress ? (
        <div role="status" className="space-y-1 text-xs text-slate-700">
          <div>{progress.label}（{progress.step}/{progress.total}）</div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200">
            <div className="h-full bg-sky-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      {error ? <div role="alert" className="text-xs text-rose-700">{error}</div> : null}
      {notice ? <div className="text-xs text-slate-700">{notice}</div> : null}

      {ambiguous ? (
        <div className="rounded border bg-white p-2 text-xs">
          同じ名前の会社が複数あります。証券コード（4桁）を付けて、もう一度取得してください：
          <ul className="list-disc pl-5">
            {ambiguous.map((c) => (
              <li key={c.edinetCode}>{c.name}（証券コード {c.secCode ?? '未確認'}／所在地 {c.address}）</li>
            ))}
          </ul>
        </div>
      ) : null}

      {candidate && view ? (
        <div className="space-y-3 rounded border bg-white p-2">
          <div className="rounded bg-slate-50 p-2 text-xs">
            <div className="font-medium">取得対象：{candidate.filer.name}（証券コード {candidate.filer.secCode ?? '未確認'}／EDINET {candidate.filer.edinetCode}）</div>
            <div className="text-slate-600">登録中の企業：{storedName || '未入力'}{storedTicker ? `（証券コード ${storedTicker}）` : ''}</div>
          </div>
          {mismatch ? (
            <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              <input type="checkbox" className="mt-0.5" checked={otherCompanyOk} onChange={(e) => setOtherCompanyOk(e.target.checked)} disabled={disabled} />
              登録中の企業と取得対象の企業が異なります。取得対象の企業の情報として反映することを確認しました。
            </label>
          ) : null}

          <div className="text-xs text-slate-700">
            取得元：{candidate.docTypeCode === '130' ? '訂正有価証券報告書' : '有価証券報告書'}（{candidate.docId}、期末 {candidate.periodEnd ?? '未確認'}）
            {candidate.amendedFromDocId ? `／元の書類 ${candidate.amendedFromDocId} より後の訂正を採用` : ''}
            ／金額の単位：円（表示は百万円に丸め）
          </div>

          <div className="font-medium text-xs">企業情報</div>
          <ul className="space-y-1 text-xs">
            {PROFILE_KEYS.filter((k) => fieldDisplay(k, candidate) !== '').map((k) => {
              const filled = filledProfile(k, current);
              return (
                <li key={k} className="flex flex-wrap items-start gap-2">
                  <label className="flex items-start gap-1">
                    <input type="checkbox" className="mt-0.5" checked={profileSel.includes(k)} onChange={() => toggle(profileSel, setProfileSel, k)} disabled={disabled || (mismatch && !otherCompanyOk)} />
                    <span className="font-medium">{PROFILE_LABEL[k]}</span>：<span className="break-all">{fieldDisplay(k, candidate)}</span>
                  </label>
                  {filled ? (
                    <label className="flex items-center gap-1 text-amber-700">
                      <input type="checkbox" checked={profileOver.includes(k)} onChange={() => toggle(profileOver, setProfileOver, k)} disabled={disabled || (mismatch && !otherCompanyOk)} />
                      入力済みの値を上書きする
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {candidate.finance.length > 0 ? (
            <>
              <div className="font-medium text-xs">財務（直近5期・単位：円）</div>
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
                    const hasExisting = hasExistingYear(y.year, financePL, financeBS);
                    return (
                      <tr key={y.year} className="align-top">
                        <td className="pr-2 font-medium">{y.year}年度</td>
                        {FINANCE_KEYS.map((k) => (
                          <td key={k} className="pr-2">{y[k] ? yen(y[k]!.value) : <span className="text-slate-400">未取得</span>}</td>
                        ))}
                        <td>
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={yearSel.includes(y.year)} onChange={() => toggle(yearSel, setYearSel, y.year)} disabled={disabled || (mismatch && !otherCompanyOk)} />
                            選ぶ
                          </label>
                          {hasExisting ? (
                            <label className="flex items-center gap-1 text-amber-700">
                              <input type="checkbox" checked={yearOver.includes(y.year)} onChange={() => toggle(yearOver, setYearOver, y.year)} disabled={disabled || (mismatch && !otherCompanyOk)} />
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

          {candidate.segments && candidate.segments.items.length > 0 ? (
            <>
              <div className="flex items-center gap-2 font-medium text-xs">
                事業セグメント（セグメント別の売上高・営業利益）
                <label className="flex items-center gap-1 font-normal">
                  <input type="checkbox" checked={segmentSel} onChange={() => setSegmentSel(!segmentSel)} disabled={disabled || (mismatch && !otherCompanyOk) || storedSegments.length > 0} />
                  反映する{storedSegments.length > 0 ? '（既に登録済みのため変更しない）' : ''}
                </label>
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pr-2">セグメント</th>
                    <th className="pr-2">売上高</th>
                    <th className="pr-2">営業利益</th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.segments.items.map((s) => (
                    <tr key={s.memberCode}>
                      <td className="pr-2">{s.name ?? <span className="text-slate-400">名称未取得（{s.memberCode}）</span>}</td>
                      <td className="pr-2">{million(s.sales)}</td>
                      <td className="pr-2">{million(s.operatingIncome)}</td>
                    </tr>
                  ))}
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
              disabled={disabled || (mismatch && !otherCompanyOk) || (profileSel.length === 0 && yearSel.length === 0 && !segmentSel)}
            >
              承認して反映
            </button>
            <button type="button" className="rounded border px-3 py-1 text-xs" onClick={() => { setView(null); setNotice(null); }}>
              取り消す
            </button>
          </div>
        </div>
      ) : null}

      {applied ? <div className="text-xs text-emerald-800">{applied}</div> : null}
    </div>
  );
}
