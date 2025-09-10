'use client';

export default function StorySubnav({
  tabs, current, onSelect, progressPct,
}: { tabs: string[]; current: number; onSelect: (i:number)=>void; progressPct:number; }) {
  return (
    <div className="sticky top-[56px] z-30 border-b border-neutral-200 bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          {tabs.map((t, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className={[
                "h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium",
                i === current
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50",
              ].join(' ')}
            >
              {t.replace(/^第\d章：/, `第${i+1}章`)}
            </button>
          ))}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
          <div className="h-1.5 bg-neutral-900" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
    </div>
  );
}
