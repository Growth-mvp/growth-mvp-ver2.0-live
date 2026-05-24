'use client';

import { useMemo, useState } from 'react';

type ExampleCase = {
  title: string;
  situation: string;
  myRecognition: string;
  otherHypothesis: string;
  alignmentQuestion: string;
};

const exampleCases: ExampleCase[] = [
  {
    title: '関連部門が期待通りに動いてくれない',
    situation:
      '関連部門へ協力を依頼しているが、対応が遅かったり、期待していた水準まで動いてもらえなかったりする。',
    myRecognition:
      'こちらは全社的に重要な取り組みだと考えているため、関連部門にも優先度を上げて協力してほしい。',
    otherHypothesis:
      '相手部門は、自部門の通常業務や直近KPIを優先すべきだと考えており、この依頼の重要度が十分に伝わっていない可能性がある。',
    alignmentQuestion:
      'この取り組みは会社全体・各部門にとってどの程度優先すべきものなのか。どこまで協力する必要があるのか。',
  },
  {
    title: '経営が現場に無理な指示を出してくる',
    situation:
      '経営から新しい方針や指示が出るが、現場の人員・時間・業務量を踏まえると、実行するのが難しいと感じる。',
    myRecognition:
      '現場の実態を十分に理解しないまま指示が出ており、このままでは既存業務にも支障が出るのではないかと感じている。',
    otherHypothesis:
      '経営側は、会社として今やるべき重要テーマであり、現場にも工夫して実行してほしいと考えている可能性がある。',
    alignmentQuestion:
      '経営が実現したいことと、現場が実行できる範囲をどう擦り合わせ、優先順位やリソース配分を見直すべきか。',
  },
  {
    title: '失敗が許されず、挑戦しにくい',
    situation:
      '会社としては挑戦や変革が求められているが、実際には失敗すると評価が下がったり責任を問われたりするため、思い切った行動が取りにくい。',
    myRecognition:
      '挑戦しろと言われても、失敗したときの責任や評価への影響が大きく、現実的には安全な選択をせざるを得ない。',
    otherHypothesis:
      '経営・管理職側は、会社の成長には新しい挑戦が必要であり、現場にも主体的に動いてほしいと考えている可能性がある。',
    alignmentQuestion:
      'どこまでの挑戦なら許容されるのか。失敗した場合に何を学び、どのように評価・改善につなげるのか。',
  },
];

export default function OrgTransformationPage() {
  const [situationText, setSituationText] = useState<string>('');
  const [myRecognitionText, setMyRecognitionText] = useState<string>('');
  const [idealText, setIdealText] = useState<string>('');
  const [expectationText, setExpectationText] = useState<string>('');

  const canSubmit = useMemo(() => {
    return [situationText, myRecognitionText, idealText, expectationText].some(
      (value) => value.trim().length > 0,
    );
  }, [situationText, myRecognitionText, idealText, expectationText]);

  const applyExample = (example: ExampleCase) => {
    setSituationText(example.situation);
    setMyRecognitionText(example.myRecognition);
    setIdealText(example.alignmentQuestion);
    setExpectationText(
      '相手側の事情や優先順位も確認したうえで、企業としてどう動くべきかを一緒に整理したい。',
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-12">
        {/* ===== 1. ページヘッダー：白枠カードなし ===== */}
        <header className="px-1 py-8 md:py-12">
          <p className="mb-3 text-xs font-semibold tracking-[0.28em] text-slate-500">
            ORGANIZATION ALIGNMENT ROOM
          </p>

          <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">
            組織変革・すり合わせルーム
          </h1>

          <p className="mt-7 max-w-4xl text-2xl font-semibold leading-relaxed text-slate-950 md:text-3xl">
            人と組織の問題を、「認識のズレ」から捉え直す。
          </p>

          <div className="mt-6 max-w-5xl space-y-4 text-base leading-8 text-slate-700 md:text-lg">
            <p>
              人と組織の問題は、意識やコミュニケーション、組織風土を変えるだけでは解決しません。
              <br />
              その背景には、{" "}
              <span className="font-semibold text-slate-950">方針・戦略、優先順位、役割責任、評価、意思決定に対する認識のズレ</span>
              {" "}が潜んでいることが多いからです。<br /><br />当ルームでは、個人が抱える違和感やモヤモヤを起点として「認識のズレ」をAIで構造的に整理。<br />会社が目指す方向性を軸に認識をかみ合わせ、組織全体の判断と行動のスピードを揃えていきます。
            </p>
          </div>

</header>

        {/* ===== 2. あるある事例 ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-2xl font-bold text-slate-950">
              よくある違和感、もやもや
            </h2>
            
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {exampleCases.map((example) => (
              <article
                key={example.title}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-base font-bold leading-7 text-slate-950">
                  {example.title}
                </h3>

                <p className="mt-2 flex-1 text-sm leading-7 text-slate-600">
                  {example.situation}
                </p>

                <button
                  type="button"
                  onClick={() => applyExample(example)}
                  className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                >
                  この事例を入力欄に反映
                </button>
              </article>
            ))}
          </div>
        </section>

        {/* ===== 3. STEP1：入力セクション ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-2xl font-bold text-slate-950">
              STEP1：もやもやと自分の認識を入力
            </h2>
            <p className="text-slate-600">
              まずは、現場で起きている違和感をそのまま入力してください。
              入力者自身の認識は本人が言語化し、AIは相手方の認識を仮説として整理します。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  1. どんな場面でもやもやしましたか？
                </span>
                <textarea
                  value={situationText}
                  onChange={(e) => setSituationText(e.target.value)}
                  placeholder="例：関連部門へ協力を依頼しているが、対応が遅かったり、期待していた水準まで動いてもらえなかったりする。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  2. その時、自分はどう受け止めましたか？
                </span>
                <textarea
                  value={myRecognitionText}
                  onChange={(e) => setMyRecognitionText(e.target.value)}
                  placeholder="例：全社的に重要な取り組みだと思っているが、相手部門には優先度が十分に伝わっていないように感じた。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  3. 本来どうあるべきだと思いますか？
                </span>
                <textarea
                  value={idealText}
                  onChange={(e) => setIdealText(e.target.value)}
                  placeholder="例：会社として優先すべき取り組みであれば、部門間で優先順位や協力範囲を明確にすべきだと思う。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  4. 相手に何を期待していましたか？
                </span>
                <textarea
                  value={expectationText}
                  onChange={(e) => setExpectationText(e.target.value)}
                  placeholder="例：相手部門の事情も踏まえたうえで、どこまで協力できるのか、どの条件なら進められるのかを話し合ってほしい。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>
            </div>

            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">
              入力された内容は、個人や部門を責めるためではなく、認識のズレを整理し、
              擦り合わせるために使います。AIの提示内容は断定ではなく、対話の入口となる仮説です。
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  // TODO: API接続時に、STAGE1〜4の戦略データを判断軸として渡す
                }}
                disabled={!canSubmit}
                className={`rounded-xl px-6 py-3 font-semibold transition-colors ${
                  !canSubmit
                    ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                    : 'bg-slate-950 text-white hover:bg-slate-900'
                }`}
              >
                AIで認識のズレを整理する
              </button>
            </div>
          </div>
        </section>

        {/* ===== 4. STEP2〜4 概要カード ===== */}
        <section>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">STEP2</p>
              <h3 className="mt-1 text-xl font-bold text-slate-950">
                相手方の認識仮説を整理
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                入力者の認識を起点に、相手方が何を重視していた可能性があるか、
                どのような前提・制約・優先順位で動いていた可能性があるかを整理します。
              </p>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                例：相手部門は「全社テーマへの非協力」ではなく、既存業務・人員不足・直近KPIを優先せざるを得ないと考えている可能性があります。
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">STEP3</p>
              <h3 className="mt-1 text-xl font-bold text-slate-950">
                企業としてあるべき認識を提示
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                STAGE1〜4で整理したMVV、経営戦略、部門戦略、OKR、重点プロジェクトを判断軸に、
                個人や部門の都合ではなく企業としてどう捉えるべきかを提示します。
              </p>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                例：重点顧客深耕が全社戦略であれば、部門ごとの都合ではなく、顧客価値・優先順位・必要リソースを共通認識にする必要があります。
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">STEP4</p>
              <h3 className="mt-1 text-xl font-bold text-slate-950">
                擦り合わせアクションへ変換
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                認識のズレを、確認すべき問い・合意すべきルール・改善アクションに変換します。
                必要に応じてOKR、役割分担、情報共有ルール、実行計画へ反映します。
              </p>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                例：依頼ルール、共有タイミング、優先順位の決め方、判断権限、次回確認日を明確にします。
              </div>
            </div>
          </div>
        </section>

        

       {/* ===== 6. このルームでできること ===== */}
<section className="space-y-5">
  <div>
    <h2 className="mb-2 text-2xl font-bold text-slate-950">
      次のアクション
    </h2>
    <p className="text-slate-600">
      個別の違和感を認識のズレとして整理し、必要なすり合わせの場をつくり、
      部門戦略や実行計画の見直しにつなげます。
    </p>
  </div>

  <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-slate-950">
        すり合わせの場を依頼
      </h3>

      <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">
        現場のもやもやを、自分の認識・相手方の認識仮説・企業としてのあるべき認識に整理します。
        AIが論点を整理したうえで、必要に応じて管理者へすり合わせの場の設定を依頼します。
      </p>

      <button
        type="button"
        onClick={() => {
          // TODO: 管理者への依頼機能を実装
        }}
        className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
      >
        すり合わせの場を依頼
      </button>
    </div>

    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-slate-950">
        部門間マップ
      </h3>

      <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">
        社内で発生している認識のズレを可視化し、どの戦略・OKR・業務連携に影響しているかを整理します。
        必要に応じて、STAGE3の部門戦略策定画面での見直しにつなげます。
      </p>

      <button
        type="button"
        onClick={() => {
          // TODO: STAGE3への遷移処理を実装
        }}
        className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
      >
        STAGE３へ
      </button>
    </div>

    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-slate-950">
        改善アクションへ反映
      </h3>

      <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">
        すり合わせ結果を、役割分担・情報共有ルール・OKR・実行計画の改善アクションとして整理します。
        必要に応じて、STAGE4の実行計画に反映します。
      </p>

      <button
        type="button"
        onClick={() => {
          // TODO: STAGE4への遷移処理を実装
        }}
        className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
      >
        STAGE４へ
      </button>
    </div>
  </div>
</section>
      </div>
    </div>
  );
}
