import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/login" className="text-[13px] text-[color:var(--accent)] hover:opacity-90 underline mb-6 inline-block">
          ← ログインに戻る
        </Link>

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 mb-6">利用規約</h1>

          <div className="prose prose-sm max-w-none text-zinc-700 space-y-4">
            <p className="text-zinc-600">
              このページは利用規約のプレースホルダーです。
              正式な利用規約については、管理者までお問い合わせください。
            </p>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mt-6 mb-3">1. サービスの利用</h2>
              <p className="text-zinc-600">
                GROWTH SHIFT は、ユーザーが企業成長をサポートするために提供されています。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mt-6 mb-3">2. ユーザーの責任</h2>
              <p className="text-zinc-600">
                ユーザーは、本サービスの利用にあたり、適用される法律を遵守してください。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mt-6 mb-3">3. 免責事項</h2>
              <p className="text-zinc-600">
                本サービスは「現状のまま」提供されています。
              </p>
            </section>

            <p className="text-[12px] text-zinc-500 mt-8 pt-8 border-t border-zinc-200">
              最終更新日：2026年7月2日
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
