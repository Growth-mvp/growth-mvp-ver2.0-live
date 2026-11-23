'use client';

import { useState } from 'react';
import type { LifecycleAction } from '@/lib/cascade/projectLifecycle';

export type PlanFacts = { executing: boolean; started: boolean };

/* プロジェクト選択欄の「…」メニュー。開いたときに計画の状態を読み、実際にできる操作だけを出す。 */
export function ProjectLifecycleMenu({
  title,
  loadFacts,
  onChoose,
}: {
  title: string;
  loadFacts: () => Promise<PlanFacts>;
  onChoose: (action: LifecycleAction, facts: PlanFacts) => void;
}) {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<PlanFacts | 'loading' | 'error' | null>(null);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setFacts('loading');
    try {
      setFacts(await loadFacts());
    } catch {
      setFacts('error');
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${title}の操作`}
        aria-expanded={open}
        onClick={() => void toggle()}
        className="h-7 w-7 rounded-full border border-zinc-300 bg-white text-sm leading-none text-zinc-700 hover:bg-zinc-50"
      >
        …
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-2 text-left text-[12px] shadow-md">
          {facts === 'loading' && <p className="text-zinc-600">計画の状態を確認しています…</p>}
          {facts === 'error' && <p className="text-danger">計画の状態を確認できませんでした。時間をおいて開き直してください。</p>}
          {facts && typeof facts === 'object' && facts.started && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onChoose('STOP', facts);
                }}
                className="block w-full rounded px-2 py-1.5 text-left font-semibold text-danger hover:bg-danger-soft"
              >
                プロジェクトを中止する
              </button>
              <p className="px-2 pb-1 text-zinc-500">中止しても、中止前の実績や支払は残ります。中止した時期以降の予定は、将来の財務効果・投資から外れます。</p>
            </>
          )}
          {facts && typeof facts === 'object' && !facts.started && !facts.executing && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onChoose('EXCLUDE', facts);
              }}
              className="block w-full rounded px-2 py-1.5 text-left font-semibold text-zinc-900 hover:bg-zinc-50"
            >
              計画から外す
            </button>
          )}
          {facts && typeof facts === 'object' && !facts.started && facts.executing && (
            <p className="px-2 py-1 text-zinc-600">採用済みの計画です。採用を取り消すと、計画から外せます。</p>
          )}
        </div>
      )}
    </div>
  );
}
