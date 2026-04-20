'use client';

export function ProjectSelectionPrompt() {
  return (
    <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-10 text-center">
      <div className="text-[14px] font-semibold text-zinc-900">プロジェクトを選択してください</div>
      <div className="mt-2 text-[12px] text-zinc-600">左の一覧からプロジェクトをクリックすると、入力フォームが開きます。</div>
    </div>
  );
}
