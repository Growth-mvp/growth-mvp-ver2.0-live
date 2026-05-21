'use client';

import { useState } from 'react';

export default function OrgTransformationPage() {
  const [problemText, setProblemText] = useState<string>('');

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto space-y-12">

        {/* ===== 1. ページヘッダー ===== */}
        <header className="text-center space-y-4 mb-12">
          <div>
            <p className="text-slate-600 text-sm tracking-widest mb-2">
              Organization Transformation
            </p>
            <h1 className="text-4xl font-bold text-slate-950 mb-4">
              組織変革・すり合わせルーム
            </h1>
          </div>
          <p className="mx-auto max-w-3xl text-xl font-semibold leading-relaxed text-slate-950">
            <span className="block">
              社員一人ひとりの違和感を、
            </span>
            <span className="block">
              組織の判断基準のずれとして可視化する。
            </span>
          </p>
          <p className="text-slate-600 max-w-3xl mx-auto leading-relaxed space-y-2 pt-2">
            <span className="block">
              部門間の対立、実行上の詰まり、情報が上がらない構造は、
            </span>
            <span className="block">
              単なる人間関係の問題ではなく、
            </span>
            <span className="block">
              戦略・優先順位・責任・評価・意思決定のずれから生じていることがあります。
            </span>
          </p>
          <p className="text-slate-600 max-w-3xl mx-auto leading-relaxed space-y-2 pt-2">
            <span className="block">
              このルームでは、現場で起きている悩みや違和感をAIが整理し、
            </span>
            <span className="block">
              関係者間のすり合わせと改善アクションにつなげます。
            </span>
          </p>
        </header>

        {/* ===== 2. STEP1：入力セクション ===== */}
        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 mb-2">
              STEP1：現場の違和感・悩みを入力
            </h2>
            <p className="text-slate-600">
              まずは、現場で起きている違和感や悩みをそのまま入力してください。
              部門間の摩擦、実行上の詰まり、情報が上がらない状況など、
              まだ整理されていない内容でも構いません。
              AIが、背景にある判断基準のずれとして整理します。
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <textarea
              value={problemText}
              onChange={(e) => setProblemText(e.target.value)}
              placeholder={`例：
部門間の仲が悪く、協力よりも牽制が多い。
会議では合意するのに、実行段階で誰も動かない。
上司に都合の悪い情報が現場から上がってこない。
数字達成が優先され、品質・安全・倫理が後回しになっている。
現場が「言っても無駄」と感じ、問題を抱え込んでいる。`}
              className="w-full border border-slate-300 rounded-xl px-4 py-3
                         text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-slate-400
                         resize-y"
              style={{ minHeight: '180px' }}
            />
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  // TODO: API接続時に処理を追加
                }}
                disabled={problemText.trim().length === 0}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  problemText.trim().length === 0
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-950 text-white hover:bg-slate-900'
                }`}
              >
                判断基準のずれを整理する
              </button>
            </div>
          </div>
        </section>

        {/* ===== 3. STEP2〜4 概要カード ===== */}
        <section>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* STEP2カード */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3">
              <div>
                <p className="text-slate-600 text-sm font-medium">STEP2</p>
                <h3 className="text-xl font-bold text-slate-950">
                  背景を掘り下げる
                </h3>
              </div>
              <p className="text-slate-600 text-sm leading-relaxed">
                なぜその問題が起きているように見えるのかを整理します。
                相手部門の役割・評価基準・制約条件を確認します。
              </p>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-500">例：</p>
                <p className="text-xs leading-6 text-slate-500">
                  現場が動かない背景には、現場側が「どうせ意見を出しても変わらない」と感じていたり、
                  管理職側が「失敗や遅れを報告されると責任を問われる」と考えている可能性があります。
                </p>
              </div>
            </div>

            {/* STEP3カード */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3">
              <div>
                <p className="text-slate-600 text-sm font-medium">STEP3</p>
                <h3 className="text-xl font-bold text-slate-950">
                  判断基準のずれを特定
                </h3>
              </div>
              <p className="text-slate-600 text-sm leading-relaxed">
                優先順位・評価基準・リスク認識・責任範囲の違いを可視化します。
                人や部門を責めるのではなく、全社方針と現場判断のずれとして整理します。
              </p>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-500">例：</p>
                <p className="text-xs leading-6 text-slate-500">
                  経営側は「短期の数字達成」を重視している一方、
                  現場側は「品質・安全・顧客信頼を守ること」を重視している可能性があります。
                  このずれが、無理な目標や問題の抱え込みにつながることがあります。
                </p>
              </div>
            </div>

            {/* STEP4カード */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3">
              <div>
                <p className="text-slate-600 text-sm font-medium">STEP4</p>
                <h3 className="text-xl font-bold text-slate-950">
                  共通判断基準と改善アクションへ反映
                </h3>
              </div>
              <p className="text-slate-600 text-sm leading-relaxed">
                STAGE1〜4の戦略設計をもとに、会社として優先すべき共通判断基準をAIが提示します。
                そのうえで、合意事項や改善アクションを整理し、OKR・実行計画・部門間連携へ反映します。
              </p>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-500">例：</p>
                <p className="text-xs leading-6 text-slate-500">
                  STAGE2で「重点顧客との長期的な信頼関係」を重視している場合、
                  短期売上だけでなく、品質・安全・顧客信頼・全社信用を共通判断基準に入れます。
                  そのうえで、問題報告を責めるのではなく早期発見として扱うルールを設定します。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ===== 4. AIが整理・可視化する観点 ===== */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 mb-2">
              AIが整理・可視化する観点
            </h2>
            <p className="text-slate-600">
              入力された悩みや違和感を、個人や部門への批判としてではなく、
              組織の判断基準のずれとして整理します。
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-medium text-slate-950 flex items-start gap-2">
                  <span className="text-slate-400">•</span>
                  <span>どの部門とどの部門で、何の判断基準がずれているか</span>
                </h4>
                <h4 className="font-medium text-slate-950 flex items-start gap-2">
                  <span className="text-slate-400">•</span>
                  <span>どの責任範囲や最終判断者が曖昧になっているか</span>
                </h4>
                <h4 className="font-medium text-slate-950 flex items-start gap-2">
                  <span className="text-slate-400">•</span>
                  <span>どの評価基準が全社方針と矛盾しているか</span>
                </h4>
              </div>
              <div className="space-y-3">
                <h4 className="font-medium text-slate-950 flex items-start gap-2">
                  <span className="text-slate-400">•</span>
                  <span>どの意思決定が属人的・非公式になっているか</span>
                </h4>
                <h4 className="font-medium text-slate-950 flex items-start gap-2">
                  <span className="text-slate-400">•</span>
                  <span>どの上位戦略が現場の行動基準に落ちていないか</span>
                </h4>
                <h4 className="font-medium text-slate-950 flex items-start gap-2">
                  <span className="text-slate-400">•</span>
                  <span>会社として、どの判断基準を共通化すべきか</span>
                </h4>
              </div>
            </div>
          </div>
        </section>

        {/* ===== 5. このルームでできること ===== */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 mb-2">
              このルームでできること
            </h2>
            <p className="text-slate-600">
              入力された悩みや違和感をもとに、関係者間のすり合わせ、
              部門間の関係性の可視化、改善アクションの管理へとつなげます。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* すり合わせルーム */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3">
              <h3 className="text-lg font-bold text-slate-950">
                すり合わせルーム
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                関係者ごとの優先順位・評価基準・リスク認識を整理し、
                判断基準のずれを可視化します。
                人や部門を責めるのではなく、
                共通判断基準と合意事項をつくるための場です。
              </p>
            </div>

            {/* 部門間マップ */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3">
              <h3 className="text-lg font-bold text-slate-950">
                部門間マップ
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                部門間の摩擦、依存関係、協働可能性を可視化します。
                どの部門同士で判断基準がずれているのか、
                どこに調整が必要なのかを把握します。
              </p>
            </div>

            {/* 改善アクション管理 */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3">
              <h3 className="text-lg font-bold text-slate-950">
                改善アクション管理
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                すり合わせで整理した共通判断基準や合意事項を、
                STAGE1〜4の戦略設計と照らし合わせながら具体的な改善アクションに落とし込みます。
                必要に応じて、OKR・実行計画・部門間連携へ反映します。
              </p>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
