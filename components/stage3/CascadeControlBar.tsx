'use client';

import { Button } from '@/components/ui/button';
import { PlusCircle, Save, ArrowRight } from 'lucide-react';

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
  onGoToStage4?: () => void;
  isGoingToStage4?: boolean;
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
  onGoToStage4,
  isGoingToStage4 = false,
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

        <Button
          className="rounded-full h-10 px-5 bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
          disabled={isHydrating || isGoingToStage4}
          onClick={onGoToStage4}
          title="STAGE3の内容をSTAGE4に引き継ぎます"
        >
          <ArrowRight className="w-4 h-4 mr-1" />
          {isGoingToStage4 ? '検証中…' : 'STAGE4へ進む'}
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
