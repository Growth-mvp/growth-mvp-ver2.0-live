'use client';

import { useStage0State } from '@/hooks/useStage0State';
import ParticipantInput from './ParticipantInput';
import CombinedRoulette from './CombinedRoulette';
import ClosingScreen from './ClosingScreen';

export default function Stage0Container() {
  const state = useStage0State();

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-orange-50 py-8 sm:py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold text-orange-900 mb-2">
            ☕ STAGE 0: アイスブレイク
          </h1>
          <p className="text-lg text-orange-700 mb-4">
            ここでは記録を残さず、気軽に話す時間にしましょう。
          </p>
          
        </div>

        {/* メインコンテンツ */}
        <div className="bg-white rounded-3xl shadow-xl p-6 sm:p-10 flex justify-center">
          {/* PHASE: 参加者入力 */}
          {state.phase === 'input' && (
            <ParticipantInput
              participants={state.participants}
              onAdd={state.addParticipant}
              onRemove={state.removeParticipant}
              onStart={() => {
                state.setPhase('spinning');
              }}
            />
          )}

          {/* PHASE: 統合ルーレット */}
          {state.phase === 'spinning' && (
            <CombinedRoulette
              participants={state.participants}
              selectedParticipant={state.currentParticipant}
              selectedTopic={state.currentTopic}
              drawnParticipants={state.drawnParticipants}
              drawnTopicIds={state.drawnTopicIds}
              totalParticipants={state.participants.length}
              onSpin={state.spinCombined}
              onNext={() => {
                // 次の抽選へ：currentParticipant と currentTopic だけをリセット（表示をクリア）
                // drawnParticipants と drawnTopicIds は保持（重複排除のため）
                // このロジックは CombinedRoulette の handleNext で行う
              }}
              onClosing={() => {
                // クロージングへ
                state.setPhase('closing');
              }}
            />
          )}

          {/* PHASE: クロージング */}
          {state.phase === 'closing' && (
            <ClosingScreen
              participantCount={state.participants.length}
              onHome={state.goHome}
              onAnotherRound={state.anotherRound}
            />
          )}
        </div>
      </div>
    </div>
  );
}
