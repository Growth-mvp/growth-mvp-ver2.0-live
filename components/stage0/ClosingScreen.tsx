'use client';

interface ClosingScreenProps {
  participantCount: number;
  onHome: () => void;
  onAnotherRound: () => void;
}

export default function ClosingScreen({ participantCount, onHome, onAnotherRound }: ClosingScreenProps) {
  return (
    <div className="stage0-result-reveal w-full max-w-2xl bg-bluegray-mist rounded-2xl border-2 border-bluegray-light shadow-xl p-8 sm:p-12 space-y-8 text-center">
      {/* タイトル */}
      <div className="space-y-3">
        <p className="text-5xl">🎉</p>
        <h2 className="text-3xl sm:text-4xl font-bold text-bluegray-deep">準備が整いました</h2>
      </div>

      {/* メインメッセージ */}
      <p className="text-xl sm:text-2xl font-semibold text-bluegray-deep">
        それでは、お互いの考えを大切にしながら、本題に入っていきましょう。
      </p>

      {/* 区切り線 */}
      <div className="border-t-2 border-bluegray-light" />

      {/* アクションボタン */}
      <div className="flex gap-3 flex-col sm:flex-row justify-center pt-4">
        <button
          onClick={onHome}
          className="flex-1 min-w-fit px-6 py-4 rounded-full font-bold text-lg transition-all duration-200 bg-accent-action text-white hover:bg-accent-hover active:scale-95 shadow-lg"
        >
          ✅ 本題へ進む
        </button>
        <button
          onClick={onAnotherRound}
          className="flex-1 min-w-fit px-6 py-4 rounded-full font-bold text-lg transition-all duration-200 bg-white text-accent-ink border-2 border-accent-action hover:bg-accent-soft active:scale-95"
        >
          🔄 もう1周する
        </button>
      </div>
    </div>
  );
}
