import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/login" className="text-[13px] text-[color:var(--accent)] hover:opacity-90 underline mb-6 inline-block">
          ← ログインに戻る
        </Link>

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 mb-2">GROWTH SHIFT プライバシーポリシー</h1>
          <p className="text-[13px] text-zinc-500 mb-8">最終更新日：2026年8月31日</p>

          <div className="prose prose-sm max-w-none text-zinc-700 space-y-6">

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">1. 事業者情報</h2>
              <p className="text-zinc-600 space-y-1">
                <div><strong>事業者：</strong>株式会社センターボード</div>
                <div><strong>代表者：</strong>石原正博</div>
                <div><strong>所在地：</strong>〒150-0002 東京都渋谷区渋谷3-5-16 渋谷3丁目スクエアビル2F</div>
                <div><strong>問い合わせ：</strong><a href="mailto:support@centerboard.co.jp" className="text-[color:var(--accent)] hover:opacity-90 underline">support@centerboard.co.jp</a></div>
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">2. ポリシーの適用範囲</h2>
              <p className="text-zinc-600 leading-relaxed">
                本ポリシーは、株式会社センターボードが提供する GROWTH SHIFT（以下「本サービス」）における個人情報および利用企業の情報の取扱いについて定めるものです。本サービスの利用にあたり、利用企業およびそのユーザーは本ポリシーに同意するものとします。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">3. 収集する情報</h2>
              <p className="text-zinc-600 font-semibold mb-2">本サービス利用時に以下の情報を収集・保存します：</p>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>認証情報：</strong>メールアドレス（ユーザー識別・通知用）</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>利用企業情報：</strong>会社名、業種、所在地等の登録情報</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>サービス利用情報：</strong>利用企業が入力する事業戦略・財務情報・意見等の各種データ</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>技術情報：</strong>アクセスログ、セッション情報、操作ログ</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>AI 生成過程のデータ：</strong>入力内容・生成結果・検証情報</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">4. 情報の利用目的</h2>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>本サービスの提供・運営・改善</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>ユーザー認証・アカウント管理</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>サービスの障害対応・セキュリティ維持</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>AI 生成品質の検証・改善</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>利用者からのお問い合わせ対応</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>重要なお知らせ・ PoC 終了通知等の通信</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">5. 個人情報入力に関する注意</h2>
              <p className="text-zinc-600 leading-relaxed">
                本サービスは、企業向けの PoC ツールです。利用企業の事業情報や財務データの入力を想定していますが、<strong>従業員の個人情報（氏名、住所、連絡先等）の入力は避けてください。</strong>誤って入力された場合、該当情報に対して適切なセキュリティ保護が適用される場合があります。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">6. 外部サービス事業者への情報処理委託</h2>
              <p className="text-zinc-600 mb-3">本サービスの提供に必要な範囲で、以下の外部サービス事業者に情報の処理を委託しています。これらの事業者は、本サービスの提供目的でのみ情報を取扱います：</p>
              <ul className="space-y-2 text-zinc-600 text-[13px]">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>Supabase：</strong>データベース・認証インフラ。メールアドレスおよびサービス利用データを保存。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>OpenAI API：</strong>AI 生成処理。入力内容が OpenAI に送信され、生成結果が返されます。OpenAI では、ご指定がない限りデータをモデル学習に使用しません（OpenAI の設定に基づく）。詳細は OpenAI のプライバシーポリシーをご参照ください。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>Vercel：</strong>アプリケーションホスティング・CDN。アクセスログ・技術情報を記録。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>Resend：</strong>メール配信サービス。通知・確認メール送信用。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>Upstash：</strong>レート制限・キャッシュ。アクセス制御データを一時保存。</span>
                </li>
              </ul>
              <p className="text-zinc-600 text-[13px] mt-3">
                各サービスのプライバシーポリシーは、各社のウェブサイトをご参照ください。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">7. 安全管理措置</h2>
              <p className="text-zinc-600 mb-3">本サービスでは、情報の保護のため以下の技術的・組織的な対策を実施しています：</p>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>通信の SSL/TLS 暗号化</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>ユーザー認証・認可によるアクセス制御</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>利用サービス事業者が提供するセキュリティ機能の活用</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">8. 情報の保存・削除</h2>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>保存期間：</strong>本サービス利用中および PoC 終了後、PoC 契約に基づく保管期間内</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>削除要望：</strong>本サービス終了時またはご要望の場合、弊社に通知いただければ、PoC 個別契約に基づき当社が管理するデータについて必要な削除対応を行います。ただし、法的保存義務がある場合は除きます。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>外部サービス事業者におけるデータ：</strong>Supabase、OpenAI、Vercel、Resend、Upstash 等の外部サービス事業者におけるデータの保持・削除については、各事業者の契約条件・保持方針等に従います。詳細は各サービスのプライバシーポリシーをご参照ください。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>OpenAI による保持：</strong>OpenAI API への入力・出力については、デフォルトではモデル学習に使用されません。ただし、API サービス提供・不正利用防止等のため一定期間保持される場合があります。詳細は OpenAI のプライバシーポリシーをご参照ください。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span><strong>PoC 改善利用：</strong>PoC 改善目的での生成ログ分析（当社で実施）は、OpenAI でのモデル学習とは別です。当社での改善分析は、利用企業の機密情報の無制限な利用・第三者提供を行いません。具体的な改善利用については、個別合意で定めます。</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">9. お問い合わせ窓口</h2>
              <p className="text-zinc-600">
                個人情報・プライバシーに関するご質問・ご懸念は、<Link href="/contact" className="text-[color:var(--accent)] hover:opacity-90 underline">お問い合わせフォーム</Link>までお願いいたします。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">10. ポリシーの変更</h2>
              <p className="text-zinc-600 leading-relaxed">
                本ポリシーは、法令変更またはサービス改善に伴い、予告なく変更される場合があります。重要な変更の場合は、利用企業にご通知いたします。
              </p>
            </section>

            <p className="text-[12px] text-zinc-500 mt-8 pt-8 border-t border-zinc-200">
              © 2026 株式会社センターボード
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
