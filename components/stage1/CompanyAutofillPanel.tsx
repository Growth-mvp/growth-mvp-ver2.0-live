'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { openCeoChatRequest, updateCeoChatMessages, useCeoChatStore } from '@/store/ceoChatStore';
import { supabase } from '@/utils/supabase/client';
import { getIndustryLabel } from '@/utils/industryTemplates';
import { useAutofillStore, type AutofillCandidate, type PendingAutofill } from '@/lib/autofill/autofillStore';
import { combineFinance, splitFinanceWrite } from '@/lib/autofill/financeWrite';
import { runAutofillPipeline, type IdentifyCandidate, type PipelineProgress, type PipelineResult } from '@/lib/autofill/client';
import { normalizeCompanyName } from '@/lib/autofill/edinetIdentify';
import { buildApplyReport, formatApplyReportText, FINANCE_SHORT_LABEL, type ApplyReport } from '@/lib/autofill/applyReport';
import {
  FINANCE_KEYS,
  PROFILE_KEYS,
  PROFILE_LABEL,
  planFilingApply,
  type ApplicableCandidate,
  type CurrentFilingProfile,
  type FinanceKey,
  type ProfileKey,
} from '@/lib/autofill/filingCandidates';
import type { PublicCandidate } from '@/lib/autofill/publicCandidate';
import { applyCandidateEdits, editsAreValid, EDITABLE_KEYS, type CandidateEdits, type EditableKey } from '@/lib/autofill/candidateEdits';

const isEditableKey = (k: ProfileKey): k is EditableKey => (EDITABLE_KEYS as readonly string[]).includes(k);
import type { SourceRef } from '@/lib/autofill/companyCandidates';

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

const DISPLAY_TEXT_MAX = 60;
const toMillion = (v: number) => Math.round(v / 1_000_000);
const millionText = (v: number | undefined) =>
  v === undefined ? '未取得' : Math.abs(v) < 1_000_000 ? `${v.toLocaleString('ja-JP')}円` : toMillion(v).toLocaleString('ja-JP');

type RowStatus = 'empty' | 'same' | 'differs' | 'none';

const isPublic = (c: AutofillCandidate): c is PublicCandidate => 'origin' in c;

function targetLabel(c: AutofillCandidate): string {
  if (!isPublic(c)) return `${c.filer.name}（証券コード ${c.filer.secCode ?? '未確認'}・${c.docTypeCode === '130' ? '訂正有価証券報告書' : '有価証券報告書'} ${c.docId}）`;
  if (c.origin === 'WEB') return `${c.filer.name}（公開情報・出典${c.sources.length}件・出典未照合）`;
  return `取り込んだ資料（${c.sources.map((s) => (s.source === 'DOCUMENT' ? s.fileName : '')).filter(Boolean).join('、') || '資料名未確認'}）`;
}

function sourceText(s: SourceRef): string {
  if (s.source === 'WEB') return `${s.title}（${s.url}）・確認日 ${s.confirmedOn}・出典未照合（原文を確認していない要約）`;
  if (s.source === 'DOCUMENT') return `資料：${s.fileName}（利用者が取り込んだ資料）`;
  return `EDINET ${s.docId}`;
}

function candidateRaw(k: ProfileKey, c: ApplicableCandidate): string {
  switch (k) {
    case 'companyName':
      return c.profile.fields.companyName?.value ?? '';
    case 'ticker':
      return c.profile.fields.ticker?.value ?? '';
    case 'fiscalYearEnd':
      return c.profile.fields.fiscalYearEnd?.value ?? '';
    case 'isListed':
      return c.profile.fields.isListed?.value === true ? 'true' : '';
    case 'location':
      return c.profileExtra.location?.value ?? '';
    case 'employees':
      return c.profileExtra.employees ? String(c.profileExtra.employees.value) : '';
    case 'businessContent':
      return c.profileExtra.businessContent?.value ?? '';
    case 'industry':
      return c.profileExtra.industry?.value ?? '';
  }
}

function currentRaw(k: ProfileKey, c: CurrentFilingProfile): string {
  if (k === 'isListed') return c.isListed === true ? 'true' : '';
  const v = c[k];
  return typeof v === 'string' ? v : '';
}

function displayRaw(k: ProfileKey, raw: string): string {
  if (!raw) return '';
  if (k === 'fiscalYearEnd') return `${raw}月`;
  if (k === 'isListed') return '上場';
  if (k === 'employees') return `${raw}名`;
  if (k === 'industry') return getIndustryLabel(raw, { full: true });
  if (k === 'businessContent' && Array.from(raw).length > DISPLAY_TEXT_MAX) return `${Array.from(raw).slice(0, DISPLAY_TEXT_MAX).join('')}…`;
  return raw;
}

function sameRaw(k: ProfileKey, a: string, b: string): boolean {
  if (k === 'companyName') return normalizeCompanyName(a) === normalizeCompanyName(b);
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
}

function profileStatus(k: ProfileKey, cand: string, cur: string): RowStatus {
  if (!cand) return 'none';
  if (!cur) return 'empty';
  return sameRaw(k, cand, cur) ? 'same' : 'differs';
}

type ExistingYearRow = { year: number };

function existingFinance(year: number, k: FinanceKey, pl: ReadonlyArray<ExistingYearRow>, bs: ReadonlyArray<ExistingYearRow>): number | undefined {
  const table = k === 'totalAssets' || k === 'netAssets' ? bs : pl;
  const row = table.find((r) => r.year === year) as unknown as Record<string, unknown> | undefined;
  const v = row?.[k];
  return typeof v === 'number' ? v : undefined;
}

type FinanceCell = { value: number; status: RowStatus; registered?: number };
type FinanceYearView = { year: number; cells: Partial<Record<FinanceKey, FinanceCell>>; hasEmpty: boolean; hasDiffers: boolean };

function financeYearViews(c: ApplicableCandidate, pl: ReadonlyArray<ExistingYearRow>, bs: ReadonlyArray<ExistingYearRow>): FinanceYearView[] {
  return c.finance.map((y) => {
    const cells: Partial<Record<FinanceKey, FinanceCell>> = {};
    let hasEmpty = false;
    let hasDiffers = false;
    for (const k of FINANCE_KEYS) {
      const cand = y[k];
      if (!cand) continue;
      const registered = existingFinance(y.year, k, pl, bs);
      const status: RowStatus = registered === undefined ? 'empty' : toMillion(registered) === toMillion(cand.value) ? 'same' : 'differs';
      if (status === 'empty') hasEmpty = true;
      if (status === 'differs') hasDiffers = true;
      cells[k] = { value: cand.value, status, registered };
    }
    return { year: y.year, cells, hasEmpty, hasDiffers };
  });
}

function saveFailureCause(reason: string, code?: string): string {
  if (code === 'REVISION_CONFLICT') return '他の利用者が同時に更新したため';
  if (reason === 'pending_queued') return '別の保存が進行中のため';
  return '保存処理が完了しなかったため';
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** 登録中の企業と取得対象の企業が違うか（取り違え防止）。登録中の情報が空なら違いとはしない */
export function differsFromRegistered(registeredName: string, registeredTicker: string, candidate: Pick<ApplicableCandidate, 'filer'>): boolean {
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
  const financePL = useStrategyStore((s) => s.financePL ?? []);
  const financeBS = useStrategyStore((s) => s.financeBS ?? []);
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
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<IdentifyCandidate[] | null>(null);
  const [view, setView] = useState<PendingAutofill | null>(null);
  const [missingPeriods, setMissingPeriods] = useState<string[]>([]);
  const [overProfile, setOverProfile] = useState<ProfileKey[]>([]);
  const [overYears, setOverYears] = useState<number[]>([]);
  const [otherCompanyOk, setOtherCompanyOk] = useState(false);
  const [done, setDone] = useState<ApplyReport | null>(null);
  const [edits, setEdits] = useState<CandidateEdits>({});
  const [webChecked, setWebChecked] = useState(false);

  useEffect(() => {
    if (!pending) return;
    if (pending.companyId !== companyId || pending.strategyId !== strategyId) return;
    setView(pending);
    setMissingPeriods([]);
    setNotice('AI経営コンサルタントが作った候補です。内容を確認して承認してください。');
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, companyId, strategyId]);

  useEffect(() => {
    setOverProfile([]);
    setOverYears([]);
    setOtherCompanyOk(false);
    setEdits({});
    setWebChecked(false);
  }, [view]);

  const candidate = useMemo(() => (view ? applyCandidateEdits(view.candidate, edits) : null), [view, edits]);

  const selection = useMemo(() => {
    if (!candidate) return null;
    const profile = PROFILE_KEYS.map((k) => {
      const cand = candidateRaw(k, candidate);
      const cur = currentRaw(k, current);
      return { key: k, cand, cur, status: profileStatus(k, cand, cur) };
    });
    const years = financeYearViews(candidate, financePL, financeBS);
    const segNew = (candidate.segments?.items.some((i) => i.name) ?? false) && storedSegments.length === 0;
    const segKept = (candidate.segments?.items.some((i) => i.name) ?? false) && storedSegments.length > 0;
    const profileTargets = profile.filter((r) => r.status === 'empty' || r.status === 'differs').map((r) => r.key);
    const yearTargets = years.filter((y) => y.hasEmpty || y.hasDiffers).map((y) => y.year);
    const applyCount =
      profile.filter((r) => r.status === 'empty' || (r.status === 'differs' && overProfile.includes(r.key))).length +
      years.filter((y) => y.hasEmpty || (y.hasDiffers && overYears.includes(y.year))).length +
      (segNew ? 1 : 0);
    const differCount = profile.filter((r) => r.status === 'differs').length + years.filter((y) => y.hasDiffers).length;
    return { profile, years, segNew, segKept, profileTargets, yearTargets, applyCount, differCount };
  }, [candidate, current, financePL, financeBS, storedSegments.length, overProfile, overYears]);

  if (process.env.NEXT_PUBLIC_STAGE1_AUTOFILL_DISABLED === 'true') return null;

  const fetchCandidates = async () => {
    setError(null);
    setNotice(null);
    setDone(null);
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
        setMissingPeriods(result.missingPeriods);
        setNotice(null);
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

  const fromDocument = candidate !== null && isPublic(candidate) && candidate.origin === 'DOCUMENT';
  const mismatch = candidate ? fromDocument || differsFromRegistered(storedName, storedTicker, candidate) : false;
  const nothingToApply = selection ? selection.applyCount === 0 : true;
  const webUnverified = candidate !== null && isPublic(candidate) && candidate.origin === 'WEB';
  const approveDisabled = Boolean(disabled) || saving || (mismatch && !otherCompanyOk) || nothingToApply || !editsAreValid(edits) || (webUnverified && !webChecked);

  const cancelView = () => {
    setView(null);
    setNotice(null);
  };

  const approve = async () => {
    if (!view || !selection || approveDisabled) return;
    const toApply = applyCandidateEdits(view.candidate, edits);
    const before = useStrategyStore.getState();
    if ((before.companyId ?? null) !== view.companyId || (before.strategyId ?? null) !== view.strategyId) {
      setError('企業が切り替わったため、反映しません。候補を取得し直してください');
      setView(null);
      return;
    }
    if (before.dirty) {
      setError('ほかに未保存の変更があるため、反映しません。画面左下の「全体保存」で保存してから、もう一度承認してください。');
      return;
    }
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const now = useStrategyStore.getState();
      const st = now as unknown as { financePL: Array<Record<string, unknown> & { year: number }>; financeBS: Array<Record<string, unknown> & { year: number }> };
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
          industry: now.industry ?? '',
        },
        currentFinance: combineFinance(pl as never, bs as never),
        candidate: toApply,
        selectedProfile: selection.profileTargets,
        overwriteProfile: overProfile,
        selectedYears: selection.yearTargets,
        overwriteYears: overYears,
        selectedSegments: selection.segNew,
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

      const res = await useStrategyStore.getState().saveStrategyData({ reason: 'stage1:autofill-approve' });
      if (!res.ok) {
        setView(null);
        setError(`反映した内容は入力欄に残っていますが、${saveFailureCause(res.reason, res.code)}保存できませんでした。画面左下の「全体保存」で保存してください。`);
        return;
      }

      const report = buildApplyReport({ plan, candidate: toApply, missingPeriods });
      setDone(report);
      setView(null);
      const ticket = openCeoChatRequest(useCeoChatStore.getState().ownerKey);
      if (ticket) {
        const content = formatApplyReportText({ companyName: toApply.filer.name || '取り込んだ資料', report });
        updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content }]);
      }
    } catch {
      setError('反映・保存に失敗しました。画面を再読み込みして、状況を確認してください。');
    } finally {
      setSaving(false);
    }
  };

  const mismatchBlocked = mismatch && !otherCompanyOk;

  return (
    <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/40 p-2 text-sm">
      <div className="font-medium text-slate-800">公開資料（有価証券報告書）から基本情報を取得</div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          会社名または証券コード
          <input className="ml-1 w-56 rounded border px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled || busy || saving} placeholder="例：日本製罐 / 5905" />
        </label>
        <button type="button" className="rounded border bg-white px-3 py-1 text-xs" onClick={fetchCandidates} disabled={disabled || busy || saving}>
          {busy ? '取得中…' : '候補を取得'}
        </button>
      </div>

      {busy && progress ? (
        <div role="status" className="space-y-1 text-xs text-slate-700">
          <div>{progress.label}（{progress.step}/{progress.total}）</div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200">
            <div className="h-full bg-sky-600 transition-all" style={{ width: `${progress.total > 0 ? Math.round((progress.step / progress.total) * 100) : 0}%` }} />
          </div>
        </div>
      ) : null}

      {saving ? <div role="status" className="text-xs text-slate-700">反映して保存しています…</div> : null}
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

      {candidate && view && selection ? (
        <div className="space-y-2 rounded border bg-white p-2 text-xs">
          <div className="font-medium text-slate-800">候補を確認・承認・保存</div>
          {candidate && isPublic(candidate) && candidate.origin === 'WEB' ? (
            <div className="rounded border border-rose-300 bg-rose-50 p-2 text-rose-800">
              出典未照合：以下はAIが公開情報の検索結果を要約したもので、出典の原文はまだ確認していません。出典のURLを開いて内容を確認するまで、反映できません。
              <label className="mt-1 flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={webChecked} onChange={(e) => setWebChecked(e.target.checked)} disabled={disabled || saving} />
                出典のURLを開き、反映する内容が原文に書かれていることを確認しました
              </label>
            </div>
          ) : null}
          <div>
            取得対象：<span className="font-medium">{targetLabel(candidate)}</span>
          </div>
          {mismatch ? (
            <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-800">
              <input type="checkbox" className="mt-0.5" checked={otherCompanyOk} onChange={(e) => setOtherCompanyOk(e.target.checked)} disabled={disabled || saving} />
              {fromDocument
                ? `取り込んだ資料が、登録中の企業（${storedName || '未入力'}）の決算資料で、金額が円単位で記載されていることを確認しました。`
                : `登録中の企業（${storedName || '未入力'}）と取得対象の企業が異なります。取得対象の企業の情報として反映することを確認しました。`}
            </label>
          ) : null}
          <div className="text-slate-600">
            未入力の項目は一括で反映します。登録済みと同じ項目は変えません
            {selection.differCount > 0 ? `。登録済みと違う ${selection.differCount} 件は、「上書き」を選んだものだけ反映します` : ''}。
          </div>

          <div className="font-medium">企業情報</div>
          <table className="w-full">
            <tbody>
              {selection.profile.map((r) => (
                <tr key={r.key} className="border-t align-top">
                  <th className="w-20 whitespace-nowrap py-1 pr-2 text-left font-medium text-slate-600">{PROFILE_LABEL[r.key]}</th>
                  <td className="break-all py-1 pr-2">
                    {isEditableKey(r.key) && (r.cand !== '' || edits[r.key] !== undefined) ? (
                      <input
                        aria-label={`編集（${PROFILE_LABEL[r.key]}）`}
                        className="w-full rounded border px-1 py-0.5"
                        value={edits[r.key] ?? r.cand}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [r.key as EditableKey]: e.target.value }))}
                        disabled={disabled || saving}
                      />
                    ) : (
                      displayRaw(r.key, r.cand) || <span className="text-slate-400">取得できず</span>
                    )}
                    {r.key === 'employees' && edits.employees !== undefined && !editsAreValid(edits) ? (
                      <div className="text-rose-700">従業員数は1以上の数字で入力してください</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">
                    {r.status === 'none' ? <span className="text-slate-400">―</span> : null}
                    {r.status === 'empty' ? '未入力 → 反映' : null}
                    {r.status === 'same' ? <span className="text-slate-500">登録済みと同じ</span> : null}
                    {r.status === 'differs' ? (
                      <div className="space-y-0.5">
                        <div className="text-amber-700">登録中：{displayRaw(r.key, r.cur)}</div>
                        <label className="flex items-center justify-end gap-1 text-amber-700">
                          <input
                            type="checkbox"
                            aria-label={`上書き（${PROFILE_LABEL[r.key]}）`}
                            checked={overProfile.includes(r.key)}
                            onChange={() => setOverProfile((l) => toggle(l, r.key))}
                            disabled={disabled || saving || mismatchBlocked}
                          />
                          上書き
                        </label>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {selection.years.length > 0 ? (
            <>
              <div className="font-medium">財務（直近5期・百万円）</div>
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1 pr-3 font-normal">年度</th>
                      {FINANCE_KEYS.map((k) => (
                        <th key={k} className="py-1 pr-3 text-right font-normal" title={k === 'netIncome' ? '親会社株主に帰属する当期純利益' : undefined}>
                          {FINANCE_SHORT_LABEL[k]}
                        </th>
                      ))}
                      <th className="w-px py-1 pl-2 text-left font-normal">扱い</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selection.years.map((y) => (
                      <tr key={y.year} className="border-t align-top">
                        <td className="py-1 pr-3 font-medium">{y.year}年度</td>
                        {FINANCE_KEYS.map((k) => {
                          const cell = y.cells[k];
                          return (
                            <td key={k} className="py-1 pr-3 text-right tabular-nums">
                              {cell ? (
                                <>
                                  {millionText(cell.value)}
                                  {cell.status === 'differs' ? <div className="text-amber-700">登録中 {millionText(cell.registered)}</div> : null}
                                </>
                              ) : (
                                <span className="text-slate-400">未取得</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="w-px py-1 pl-2">
                          {y.hasDiffers ? (
                            <label className="flex items-center gap-1 text-amber-700">
                              <input
                                type="checkbox"
                                aria-label={`上書き（${y.year}年度）`}
                                checked={overYears.includes(y.year)}
                                onChange={() => setOverYears((l) => toggle(l, y.year))}
                                disabled={disabled || saving || mismatchBlocked}
                              />
                              上書き{y.hasEmpty ? '（未入力分は反映）' : ''}
                            </label>
                          ) : y.hasEmpty ? (
                            '未入力 → 反映'
                          ) : (
                            <span className="text-slate-500">登録済みと同じ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {selection.segNew && candidate.segments ? (
            <>
              <div className="font-medium">事業セグメント（百万円）</div>
              <ul className="space-y-0.5">
                {candidate.segments.items
                  .filter((s) => s.name)
                  .map((s) => (
                    <li key={s.memberCode} className="flex flex-wrap gap-x-3">
                      <span className="font-medium">{s.name}</span>
                      <span className="whitespace-nowrap">売上高 {millionText(s.sales)}</span>
                      <span className="whitespace-nowrap">営業利益 {millionText(s.operatingIncome)}</span>
                    </li>
                  ))}
              </ul>
            </>
          ) : selection.segKept ? (
            <div className="text-slate-500">事業セグメント：登録済みのため変更しません</div>
          ) : null}

          <details className="text-[11px] text-slate-600">
            <summary className="cursor-pointer">出典・注意（{candidate.issues.length}件）</summary>
            <div className="mt-1">
              {isPublic(candidate) ? (
                <>
                  <div>取得元（金額は円・表示は百万円に丸め）：</div>
                  <ul className="list-disc pl-5">
                    {candidate.sources.map((s) => (
                      <li key={s.source === 'WEB' ? s.url : s.source === 'DOCUMENT' ? s.fileName : s.docId}>{sourceText(s)}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  取得元：{candidate.filer.name}（EDINET {candidate.filer.edinetCode}）・書類 {candidate.docId}・期末 {candidate.periodEnd ?? '未確認'}・金額の単位は円（表示は百万円に丸め）
                  {candidate.amendedFromDocId ? `・元の書類 ${candidate.amendedFromDocId} より後の訂正を採用` : ''}
                </>
              )}
            </div>
            <ul className="list-disc pl-5">
              {candidate.issues.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              onClick={approve}
              disabled={approveDisabled}
            >
              承認して反映・保存
            </button>
            <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={cancelView} disabled={saving}>
              取り消す
            </button>
            {nothingToApply && !mismatchBlocked ? <span className="text-slate-600">反映する項目はありません（すべて登録済みと同じです）</span> : null}
          </div>
        </div>
      ) : null}

      {done ? (
        <div className="space-y-0.5 rounded border border-emerald-300 bg-white p-2 text-xs text-emerald-900">
          <div className="font-medium">反映し、保存しました</div>
          {done.applied.length > 0 ? <div>反映：{done.applied.join('／')}</div> : null}
          {done.kept.map((t) => (
            <div key={t}>{t}</div>
          ))}
          {done.unfetched.length > 0 ? <div className="text-slate-700">未取得（推測で補っていません）：{done.unfetched.join('、')}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
