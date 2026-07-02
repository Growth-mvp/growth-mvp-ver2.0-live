import Link from 'next/link';

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/login" className="text-[13px] text-[color:var(--accent)] hover:opacity-90 underline mb-6 inline-block">
          ← ログインに戻る
        </Link>

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 mb-6">お問い合わせ</h1>

          <div className="space-y-6">
            <p className="text-zinc-600">
              GROWTH SHIFT についてのご質問やご支援が必要な場合は、下記までお問い合わせください。
            </p>

            <section className="bg-slate-50 rounded-xl p-6 border border-slate-200">
              <h2 className="text-[16px] font-semibold text-zinc-900 mb-3">管理者へのお問い合わせ</h2>
              <p className="text-[13px] text-zinc-600 mb-4">
                ログイン、パスワード、アカウント、または機能についてのご質問は、
                管理者までお問い合わせください。
              </p>
              <p className="text-[13px] text-zinc-500">
                管理者のメールアドレスはシステム管理者までお尋ねください。
              </p>
            </section>

            <section className="bg-slate-50 rounded-xl p-6 border border-slate-200">
              <h2 className="text-[16px] font-semibold text-zinc-900 mb-3">機能・フィードバック</h2>
              <p className="text-[13px] text-zinc-600 mb-4">
                新機能のご提案やフィードバックについては、
                管理者までお知らせください。
              </p>
              <p className="text-[13px] text-zinc-500">
                皆様のご意見は、サービス改善に活かされます。
              </p>
            </section>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mt-6">
              <p className="text-[12px] text-emerald-800">
                <span className="font-semibold">注：</span> このページはプレースホルダーです。
                正式なお問い合わせフォームについては、管理者までお問い合わせください。
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
