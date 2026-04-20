'use client';

import { Button } from '@/components/ui/button';
import { PlusCircle, Save } from 'lucide-react';

interface CascadeControlBarProps {
  activeTab: 'edit' | 'visual';
  setActiveTab: (tab: 'edit' | 'visual') => void;
  isHydrating: boolean;
  saveNow: any;
  persistCascadeNow: (reason: string) => Promise<boolean>;
  setNotice: (notice: string) => void;
  canEditCompany: boolean;
  showForm: boolean;
  setShowForm: (value: boolean | ((prev: boolean) => boolean)) => void;
}

export function CascadeControlBar({
  activeTab,
  setActiveTab,
  isHydrating,
  saveNow,
  persistCascadeNow,
  setNotice,
  canEditCompany,
  showForm,
  setShowForm,
}: CascadeControlBarProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
      <div className="inline-flex border rounded-full overflow-hidden">
        {(['edit', 'visual'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm ${activeTab === t ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'}`}
            disabled={isHydrating}
          >
            {t === 'edit' ? '編集ビュー' : 'ビジュアルビュー'}
          </button>
        ))}
      </div>

      <div className="flex gap-2 justify-end flex-wrap">
        <Button
          variant="outline"
          className="rounded-full h-10 px-5 bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm"
          disabled={isHydrating}
          onClick={async () => {
            if (!saveNow) return;
            try {
              setNotice('💾 保存中です…');
              const ok = await persistCascadeNow('manual-stage3-save');
              if (ok) setNotice('✅ 全体を保存しました（サーバーにも反映済み）');
            } catch (e: any) {
              setNotice(`❌ 保存に失敗しました：${e?.message ?? '不明なエラー'}`);
            }
          }}
        >
          <Save className="w-4 h-4 mr-1" />
          全体保存
        </Button>

        {canEditCompany && (
          <Button onClick={() => setShowForm((v) => !v)} className="rounded-full h-10 px-5 border border-zinc-300 bg-white hover:bg-zinc-50 shadow-sm" disabled={isHydrating}>
            <PlusCircle className="w-4 h-4 mr-1" />
            {showForm ? '閉じる' : '部門を追加'}
          </Button>
        )}
      </div>
    </div>
  );
}
