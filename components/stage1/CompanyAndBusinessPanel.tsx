// /components/stage1/CompanyAndBusinessPanel.tsx
'use client';

import CompanyScopePanel from './CompanyScopePanel';
import BusinessSegmentsPanel from './BusinessSegmentsPanel';

/**
 * ①②統合パネル
 * - 企業情報（CompanyScopePanel）
 * - 事業内容（BusinessSegmentsPanel）
 * を縦積みで表示
 */
export default function CompanyAndBusinessPanel({ readOnly, disabled }: { readOnly?: boolean; disabled?: boolean }) {
  return (
    <div className="space-y-6">
      {/* 企業情報 */}
      <div>
        <h3 className="text-lg font-semibold mb-4">企業情報</h3>
        <CompanyScopePanel readOnly={readOnly} disabled={disabled} />
      </div>

      {/* 事業内容 */}
      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-semibold mb-4">事業内容</h3>
        <BusinessSegmentsPanel readOnly={readOnly} disabled={disabled} />
      </div>
    </div>
  );
}
