// /components/stage1/CompanyScopePanel.tsx
'use client';

import { useMemo, useCallback } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { FISCAL_YEAR_END_MONTHS, normalizeFiscalYearEnd } from '@/utils/stage6/fiscalYear';
import { getIndustryLabel, selectableIndustryOptions } from '@/utils/industryTemplates';
import {
  EMPLOYEE_BANDS,
  OVERSEAS_LOCATION,
  PREFECTURES,
  formatHeadquartersLocation,
  parseHeadquartersLocation,
  type HeadquartersLocation,
} from '@/lib/stage1/companyProfile';

const SELECT_CLASS = 'border px-3 py-2 w-full disabled:bg-gray-100 disabled:cursor-not-allowed';

export default function CompanyScopePanel({ readOnly, disabled }: { readOnly?: boolean; disabled?: boolean }) {
  const companyName = useStrategyStore((s: StrategyState) => s.companyName ?? '');
  const industry = useStrategyStore((s: StrategyState) => s.industry ?? '');
  const location = useStrategyStore((s: StrategyState) => s.location ?? '');
  const employees = useStrategyStore((s: StrategyState) => s.employees ?? '');
  const fiscalYearEnd = useStrategyStore((s: StrategyState) => normalizeFiscalYearEnd(s.fiscalYearEnd));
  const setProfile = useStrategyStore((s: StrategyState) => s.setProfile);

  const headquarters = useMemo(() => parseHeadquartersLocation(location), [location]);

  const locationSelectValue =
    headquarters.kind === 'overseas'
      ? OVERSEAS_LOCATION
      : headquarters.kind === 'prefecture'
        ? headquarters.prefecture
        : headquarters.kind === 'legacy'
          ? headquarters.raw
          : '';

  const industryKnown = selectableIndustryOptions.some((o) => o.value === industry);

  const handleFiscalYearEndChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (disabled) return;
      setProfile({ fiscalYearEnd: normalizeFiscalYearEnd(e.target.value) });
    },
    [setProfile, disabled]
  );

  const handleCompanyNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      setProfile({ companyName: e.target.value });
    },
    [setProfile, disabled]
  );

  const handleIndustryChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (disabled) return;
      setProfile({ industry: e.target.value });
    },
    [setProfile, disabled]
  );

  const handleLocationChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (disabled) return;
      const v = e.target.value;
      let next: HeadquartersLocation;
      if (!v) next = { kind: 'unset' };
      else if (v === OVERSEAS_LOCATION) {
        next = { kind: 'overseas', detail: headquarters.kind === 'overseas' ? headquarters.detail : '' };
      } else if ((PREFECTURES as readonly string[]).includes(v)) next = { kind: 'prefecture', prefecture: v };
      else next = { kind: 'legacy', raw: v };
      setProfile({ location: formatHeadquartersLocation(next) });
    },
    [setProfile, disabled, headquarters]
  );

  const handleOverseasDetailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      setProfile({ location: formatHeadquartersLocation({ kind: 'overseas', detail: e.target.value }) });
    },
    [setProfile, disabled]
  );

  const handleEmployeesChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (disabled) return;
      setProfile({ employees: e.target.value });
    },
    [setProfile, disabled]
  );

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">対象企業</h2>

      <p className="text-sm text-gray-600 mb-6">
        STAGE1（企業価値分析）の前提となる企業情報を、最小限で設定します。
      </p>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1">会社名</label>
          <input
            className="border px-3 py-2 w-full disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="例：株式会社センターボード"
            value={companyName}
            onChange={handleCompanyNameChange}
            disabled={disabled}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">業種</label>
          <select className={SELECT_CLASS} value={industry} onChange={handleIndustryChange} disabled={disabled}>
            <option value="">選択してください</option>
            {!industryKnown && industry && (
              <option value={industry}>既存の値：{getIndustryLabel(industry, { full: true })}</option>
            )}
            {selectableIndustryOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-1">本社所在地</label>
            <select
              className={SELECT_CLASS}
              value={locationSelectValue}
              onChange={handleLocationChange}
              disabled={disabled}
            >
              <option value="">未選択</option>
              {headquarters.kind === 'legacy' && <option value={headquarters.raw}>既存の値：{headquarters.raw}</option>}
              {PREFECTURES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value={OVERSEAS_LOCATION}>海外</option>
            </select>
            {headquarters.kind === 'overseas' && (
              <input
                className={`${SELECT_CLASS} mt-2`}
                placeholder="国・地域（任意）例：ベトナム、タイ"
                value={headquarters.detail}
                maxLength={100}
                onChange={handleOverseasDetailChange}
                disabled={disabled}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">従業員数</label>
            <select className={SELECT_CLASS} value={employees} onChange={handleEmployeesChange} disabled={disabled}>
              <option value="">未選択</option>
              {employees && !EMPLOYEE_BANDS.some((b) => b.value === employees) && (
                <option value={employees}>既存の値：{employees}</option>
              )}
              {EMPLOYEE_BANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">決算月</label>
          <select className={SELECT_CLASS} value={fiscalYearEnd} onChange={handleFiscalYearEndChange} disabled={disabled}>
            <option value="">未設定</option>
            {FISCAL_YEAR_END_MONTHS.map((m) => (
              <option key={m} value={String(m)}>
                {m}月
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            未設定の場合、年度別の投資額・資金計画は確定値として扱いません。
          </p>
        </div>
      </div>
    </section>
  );
}
