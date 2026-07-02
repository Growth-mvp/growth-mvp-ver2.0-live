import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/login" className="text-[13px] text-[color:var(--accent)] hover:opacity-90 underline mb-6 inline-block">
          ← ログインに戻る
        </Link>

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 mb-6">プライバシーポリシー</h1>

          <div className="prose prose-sm max-w-none text-zinc-700 space-y-4">
            <p className="text-zinc-600">
              このページはプライバシーポリシーのプレースホルダーです。
              正式なプライバシーポリシーについては、管理者までお問い合わせください。
            </p>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mt-6 mb-3">1. 情報の収集</h2>
              <p className="text-zinc-600">
                GROWTH SHIFT は、サービス提供のために必要な情報を収集しています。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mt-6 mb-3">2. 情報の利用</h2>
              <p className="text-zinc-600">
                収集した情報は、サービスの改善とユーザー体験の向上に使用されます。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mt-6 mb-3">3. 情報の保護</h2>
              <p className="text-zinc-600">
                ユーザーの個人情報は、適切なセキュリティ対策によって保護されています。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mt-6 mb-3">4. お問い合わせ</h2>
              <p className="text-zinc-600">
                プライバシーに関するご質問については、管理者までお問い合わせください。
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
