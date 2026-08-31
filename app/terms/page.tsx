import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/login" className="text-[13px] text-[color:var(--accent)] hover:opacity-90 underline mb-6 inline-block">
          ← ログインに戻る
        </Link>

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 mb-2">GROWTH SHIFT PoC 利用規約</h1>
          <p className="text-[13px] text-zinc-500 mb-8">最終更新日：2026年8月31日</p>

          <div className="prose prose-sm max-w-none text-zinc-700 space-y-6">

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">1. 規約の適用</h2>
              <p className="text-zinc-600 leading-relaxed">
                本規約は、株式会社センターボードが提供する GROWTH SHIFT（以下「本サービス」）の概要版・試験版・PoC（Proof of Concept）段階での利用に適用されます。本サービスの利用企業（以下「利用企業」）は、本規約に同意することで本サービスの利用が許可されるものとします。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">2. サービスの性質</h2>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>GROWTH SHIFT は、現在 PoC・試験提供段階であり、完成版サービスではありません。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>AI により生成される内容に誤り・不足・不適切な出力が生じる可能性があります。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>システム上の不具合、一時停止、機能変更が予告なく発生する可能性があります。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>サービス内容は予告なく変更・廃止される場合があります。</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">3. AI生成内容に関する責任</h2>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>AI 生成内容は、経営判断・投資判断・人事判断等を補助するものであり、最終判断は利用企業が行うものとします。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>生成結果の完全性・正確性・適用可能性について、株式会社センターボードは保証しません。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>生成内容に基づく利用企業の判断・施策により生じた損害について、株式会社センターボードは一切責任を負いません。</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">4. 入力情報に関する注意</h2>
              <p className="text-zinc-600 font-semibold mb-2">本サービスに以下の情報を入力しないでください：</p>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>個人情報（氏名、住所、電話番号等）</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>個人を特定できる情報</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>要配慮個人情報（健康情報、信仰、犯罪経歴等）</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>パスワード、API キー、認証情報</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>その他入力する必要のない機密情報</span>
                </li>
              </ul>
              <p className="text-zinc-600 mt-4">
                利用企業の事業戦略・財務データ・事業情報等、PoC 検証に必要な情報については、利用企業自身の責任・権限のもとで入力することができますが、入力の可否および程度については利用企業が判断してください。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">5. 組織変革ルーム利用規則</h2>
              <p className="text-zinc-600 mb-2">本サービスに含まれる組織変革ルーム機能では、従業員が意見や違和感を入力できます。以下の情報は入力しないでください：</p>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>他者への誹謗中傷</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>個人攻撃</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>不必要な個人名・個人を特定する情報</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>違法または不適切な情報</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">6. PoC 個別合意</h2>
              <p className="text-zinc-600 leading-relaxed">
                各 PoC ごとに、利用期間、対象範囲、利用者、終了後のデータ取扱い、NDA、覚書等の個別合意を定めることができます。その場合、個別合意の条項が本規約より優先して適用されます。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">7. 費用</h2>
              <p className="text-zinc-600 leading-relaxed">
                本サービスの利用費用は、各 PoC の個別合意に基づきます。AI API 等の利用にあたり著しく過大な利用が発生した場合、事前協議の上で実費相当額をご負担いただく場合があります。ただし、予告なく利用企業に対して課金することはありません。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">8. 禁止事項</h2>
              <p className="text-zinc-600 mb-2">利用企業は、以下の行為を行わないものとします：</p>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>本サービスのシステムへの不正アクセス、破壊、改ざん</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>本サービスの過度な負荷をかける利用</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>第三者へのアカウント提供・共有</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>本サービスのコンテンツの無権限な複製・転載</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>違法または有害な目的での利用</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>その他、株式会社センターボードが不適切と判断する利用</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">9. 知的財産権</h2>
              <ul className="space-y-2 text-zinc-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>GROWTH SHIFT のシステム、仕組み、UI、プログラム、アルゴリズム、その他すべての知的財産は、株式会社センターボード またはその正当な権利者に帰属します。</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0">•</span>
                  <span>利用企業が本サービスに入力した情報自体の権利は、利用企業に帰属します。ただし、PoC 改善・検証の目的での利用に同意するものとします。</span>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">10. PoC 改善利用</h2>
              <p className="text-zinc-600 leading-relaxed">
                株式会社センターボードは、本サービスの生成品質・機能・UI・有効性等の検証および改善を目的として、利用企業のご協力を得ることがあります。ただし、利用企業の機密情報の無制限な二次利用・第三者提供は行いません。具体的な改善利用については、個別の合意で定めます。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">11. 保証の否認</h2>
              <p className="text-zinc-600 leading-relaxed">
                本サービスは「現状のまま」提供されます。株式会社センターボードは、本サービスの安定性・信頼性・特定の目的への適合性について、明示的または黙示的な保証をしません。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">12. 責任制限</h2>
              <p className="text-zinc-600 leading-relaxed">
                PoC 試験段階のサービスの性質を踏まえ、本サービスの利用により生じた直接的・間接的な損害について、株式会社センターボードの責任は、利用企業が支払った利用料金相当額（無償の場合はゼロ）に限定されます。データ損失、利益損失、事業中断等による損害賠償は求めないものとします。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">13. 規約の変更</h2>
              <p className="text-zinc-600 leading-relaxed">
                株式会社センターボードは、本規約を予告なく変更することがあります。重要な変更の場合は、利用企業に通知いたします。
              </p>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-zinc-900 mb-3">14. お問い合わせ</h2>
              <p className="text-zinc-600">
                本規約に関するご質問・ご不明な点は、<Link href="/contact" className="text-[color:var(--accent)] hover:opacity-90 underline">お問い合わせ</Link>までお願いいたします。
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
