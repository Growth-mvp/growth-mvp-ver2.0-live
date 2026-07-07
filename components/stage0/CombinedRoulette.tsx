'use client';

import { useState, useCallback } from 'react';
import { Topic } from '@/utils/stage0Topics';

type SpinState = 'idle' | 'spinningParticipant' | 'spinningTopic' | 'complete';

interface CombinedRouletteProps {
  participants: string[];
  selectedParticipant: string | null;
  selectedTopic: Topic | null;
  drawnParticipants: Set<string>;
  drawnTopicIds: Set<string>;
  totalParticipants: number;
  onSpin: () => Promise<void>;
  onNext: () => void;
  onClosing: () => void;
}

export default function CombinedRoulette({
  participants,
  selectedParticipant,
  selectedTopic,
  drawnParticipants,
  drawnTopicIds,
  totalParticipants,
  onSpin,
  onNext,
  onClosing,
}: CombinedRouletteProps) {
  const [spinState, setSpinState] = useState<SpinState>('idle');

  const handleSpin = useCallback(async () => {
    setSpinState('spinningParticipant');
    await onSpin();
    setTimeout(() => {
      setSpinState('spinningTopic');
    }, 1200);

    setTimeout(() => {
      setSpinState('complete');
    }, 1200 + 300 + 1600);
  }, [onSpin]);

  const handleNext = useCallback(() => {
    onNext();
    setSpinState('idle');
  }, [onNext]);

  const drawnCount = drawnParticipants.size;
  const isAllDrawn = drawnCount >= totalParticipants;

  const getButtonText = () => {
    if (spinState === 'idle') return '🎯 スピン';
    if (spinState === 'spinningParticipant' || spinState === 'spinningTopic') return '✨ 抽選中...';
    if (spinState === 'complete') {
      return isAllDrawn ? '✅ クロージングへ' : '➡️ 次の抽選へ';
    }
    return 'スピン';
  };

  const getParticipantDisplay = () => {
    if (spinState === 'idle') {
      return <p className="text-gray-400 text-sm">決定待ち</p>;
    }
    return (
      <span className="text-4xl md:text-5xl font-bold text-orange-700 leading-tight">
        {selectedParticipant || '決定待ち'}
      </span>
    );
  };

  const getTopicDisplay = () => {
    if (spinState === 'idle' || spinState === 'spinningParticipant') {
      return <p className="text-gray-400 text-sm">決定待ち</p>;
    }
    if (selectedTopic) {
      return (
        <p className="text-xl md:text-2xl font-bold text-orange-700 leading-relaxed break-words">
          {selectedTopic.text}
        </p>
      );
    }
    return <p className="text-gray-400 text-sm">決定待ち</p>;
  };

  const isButtonDisabled = spinState !== 'idle' && spinState !== 'complete';
  const progress = totalParticipants > 0 ? (drawnCount / totalParticipants) * 100 : 0;

  return (
    <div className="w-full max-w-2xl space-y-8">
      {/* タイトル */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">抽選を開始</h2>
        <p className="text-gray-600 text-sm mt-2">スピンボタンを押して、今回の人とお題を決めます</p>
      </div>

      {/* ルーレット表示エリア */}
      <div className="grid grid-cols-2 gap-6">
        {/* 参加者スロット */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs sm:text-sm text-slate-500 font-medium">今回話す人</p>
          <div className="relative w-full min-h-[120px] bg-gradient-to-br from-orange-100 to-amber-50 rounded-2xl border-2 border-orange-300 shadow-lg flex items-center justify-center overflow-hidden">
            <div
              className={
                spinState === 'spinningParticipant' ? 'stage0-slot-spinning' : 'stage0-fade-in'
              }
            >
              {getParticipantDisplay()}
            </div>
          </div>
        </div>

        {/* お題スロット */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs sm:text-sm text-slate-500 font-medium">お題</p>
          <div className="relative w-full min-h-[120px] bg-gradient-to-br from-orange-100 to-amber-50 rounded-2xl border-2 border-orange-300 shadow-lg flex items-center justify-center overflow-hidden px-5">
            <div
              className={
                spinState === 'spinningTopic' ? 'stage0-slot-spinning' : 'stage0-fade-in'
              }
            >
              {getTopicDisplay()}
            </div>
          </div>
        </div>
      </div>

      {/* 進捗表示（complete の時だけ表示） */}
      {spinState === 'complete' && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-orange-600">{drawnCount}</span>
            <span> / {totalParticipants}人が話しました</span>
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-orange-400 to-orange-500 h-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* ボタン */}
      <div className="flex justify-center">
        {spinState === 'complete' ? (
          <button
            onClick={isAllDrawn ? onClosing : handleNext}
            className="px-10 py-4 rounded-full font-bold text-lg transition-all duration-200 bg-orange-500 text-white hover:bg-orange-600 active:scale-95 shadow-lg hover:shadow-xl"
          >
            {getButtonText()}
          </button>
        ) : (
          <button
            onClick={handleSpin}
            disabled={isButtonDisabled}
            className={[
              'px-10 py-4 rounded-full font-bold text-lg transition-all duration-200',
              isButtonDisabled
                ? 'bg-gray-400 text-white cursor-not-allowed opacity-75'
                : 'bg-orange-500 text-white hover:bg-orange-600 active:scale-95 shadow-lg hover:shadow-xl',
            ].join(' ')}
          >
            {getButtonText()}
          </button>
        )}
      </div>
    </div>
  );
}
