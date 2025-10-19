'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useUserStore } from '@/store/userStore';
import {
  getCompanyIdFromCookie,
  setCompanyIdCookie,
} from '@/utils/supabase/client';
import { hardResetForCompanySwitch } from '@/utils/resetAll';

/**
 * ===========================================================
 * CompanyContext（改良版）
 * -----------------------------------------------------------
 * ・アプリ全体で「現在の companyId」を一元管理
 * ・URL > Cookie > membership(default) の順で決定
 * ・companyId変更時に hardResetForCompanySwitch() を呼ぶ
 * ===========================================================
 */

type CompanyContextType = {
  companyId: string | null;
  setCompanyId: (id: string | null) => void;
};

const CompanyContext = createContext<CompanyContextType>({
  companyId: null,
  setCompanyId: () => {},
});

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUserStore();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const prevCompanyId = useRef<string | null>(null);

  /**
   * -----------------------------------------------------------
   * 初期決定：Cookie → membership → default
   * -----------------------------------------------------------
   */
  useEffect(() => {
    const byCookie = getCompanyIdFromCookie();
    if (byCookie) {
      setCompanyId(byCookie);
      return;
    }

    // userStore に membership 情報がある場合
    const memberships = (user as any)?.memberships || [];
    if (memberships.length > 0) {
      const defaultCompany = memberships[0]?.company_id;
      if (defaultCompany) setCompanyId(defaultCompany);
    }
  }, [user]);

  /**
   * -----------------------------------------------------------
   * companyId 変更時：
   *  - Cookie 同期
   *  - ストア／キャッシュ／Storage をリセット
   * -----------------------------------------------------------
   */
  useEffect(() => {
    if (companyId === prevCompanyId.current) return;

    // Cookie 同期
    if (companyId) {
      setCompanyIdCookie(companyId);
    }

    // リセット（前の会社IDと異なる場合のみ）
    if (prevCompanyId.current !== null) {
      hardResetForCompanySwitch(companyId);
    }

    prevCompanyId.current = companyId;
  }, [companyId]);

  const value = useMemo(() => ({ companyId, setCompanyId }), [companyId]);

  return (
    <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
  );
}

export const useCompany = () => useContext(CompanyContext);
