/* 実アプリのレイアウト確認用の素通し部品（評価専用）。MFA確認・会社コンテキストは実際の認証を行わず、子要素をそのまま描画する。 */
import type { ReactNode } from 'react';

export default function MfaGate(_props: unknown): null {
  return null;
}

export function CompanyProvider({ children }: { children?: ReactNode }): ReactNode {
  return children;
}

export function useCompany(): { companyId: string } {
  return { companyId: '00000000-0000-4000-8000-00000000c0de' };
}
