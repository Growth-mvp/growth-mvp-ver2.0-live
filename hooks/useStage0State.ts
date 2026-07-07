'use client';

import { useState, useCallback } from 'react';
import { Topic, STAGE0_TOPICS } from '@/utils/stage0Topics';

export interface Stage0State {
  // 参加者管理
  participants: string[];
  addParticipant(name: string): void;
  removeParticipant(index: number): void;

  // セッション状態
  phase: 'input' | 'spinning' | 'result' | 'closing';
  setPhase(phase: Stage0State['phase']): void;

  // 抽選結果
  currentParticipant: string | null;
  currentTopic: Topic | null;
  drawnParticipants: Set<string>;
  drawnTopicIds: Set<string>;

  // 抽選アクション
  spinCombined(): Promise<void>;
  spinParticipant(): Promise<void>;
  spinTopic(): Promise<void>;
  nextRound(): void;
  anotherRound(): void;
  goHome(): void;

  // UI state
  isSpinning: boolean;
}

export function useStage0State(): Stage0State {
  // 参加者管理（sessionのみ）
  const [participants, setParticipants] = useState<string[]>([]);

  // セッション状態
  const [phase, setPhase] = useState<'input' | 'spinning' | 'result' | 'closing'>('input');

  // 抽選結果
  const [currentParticipant, setCurrentParticipant] = useState<string | null>(null);
  const [currentTopic, setCurrentTopic] = useState<Topic | null>(null);

  // 重複排除（セッションのみ）
  const [drawnParticipants, setDrawnParticipants] = useState<Set<string>>(new Set());
  const [drawnTopicIds, setDrawnTopicIds] = useState<Set<string>>(new Set());

  // スピン中フラグ
  const [isSpinning, setIsSpinning] = useState(false);

  const spinCombined = useCallback(async () => {
    setIsSpinning(true);

    // 当選済みでない参加者リスト
    const availableParticipants = participants.filter((p) => !drawnParticipants.has(p));
    if (availableParticipants.length === 0) {
      setIsSpinning(false);
      return;
    }

    // 当選済みでないお題リスト
    let availableTopics = STAGE0_TOPICS.filter((t) => !drawnTopicIds.has(t.id));
    if (availableTopics.length === 0) {
      // お題が足りなくなった場合はリセット
      availableTopics = STAGE0_TOPICS;
      setDrawnTopicIds(new Set());
    }

    // 今回の抽選結果を決定（availableParticipants から選ぶ）
    const selectedParticipant = availableParticipants[Math.floor(Math.random() * availableParticipants.length)];
    const selectedTopic = availableTopics[Math.floor(Math.random() * availableTopics.length)];

    // 参加者スロット回転：1.2秒間
    const participantSpinDuration = 1200;
    const participantItemDuration = 40;
    const participantItemCount = Math.floor(participantSpinDuration / participantItemDuration);

    let participantIndex = 0;
    const participantInterval = setInterval(() => {
      // ランダム表示用：全participants から選ぶ（ビジュアル用、最終結果に影響しない）
      const randomParticipant = participants[Math.floor(Math.random() * participants.length)];
      setCurrentParticipant(randomParticipant);
      participantIndex++;

      if (participantIndex >= participantItemCount) {
        clearInterval(participantInterval);
        setCurrentParticipant(selectedParticipant);

        // 参加者確定後、お題スロット開始
        setTimeout(() => {
          // お題スロット回転：1.6秒間
          const topicSpinDuration = 1600;
          const topicItemDuration = 40;
          const topicItemCount = Math.floor(topicSpinDuration / topicItemDuration);

          let topicIndex = 0;
          const topicInterval = setInterval(() => {
            // ランダム表示用：全STAGE0_TOPICS から選ぶ（ビジュアル用、最終結果に影響しない）
            const randomTopic = STAGE0_TOPICS[Math.floor(Math.random() * STAGE0_TOPICS.length)];
            setCurrentTopic(randomTopic);
            topicIndex++;

            if (topicIndex >= topicItemCount) {
              clearInterval(topicInterval);
              setCurrentTopic(selectedTopic);

              // 当選済みに追加
              setDrawnParticipants((prev) => new Set([...prev, selectedParticipant]));
              setDrawnTopicIds((prev) => new Set([...prev, selectedTopic.id]));

              setIsSpinning(false);

              console.log('[STAGE0 combined spin complete]', {
                selectedParticipant,
                selectedTopic: selectedTopic.text,
              });
            }
          }, topicItemDuration);
        }, 300); // 参加者確定から300ms後にお題スロット開始
      }
    }, participantItemDuration);
  }, [participants, drawnParticipants, drawnTopicIds]);

  const addParticipant = useCallback((name: string) => {
    if (name.trim()) {
      setParticipants((prev) => {
        if (prev.includes(name)) return prev; // 重複チェック
        return [...prev, name];
      });
    }
  }, []);

  const removeParticipant = useCallback((index: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const spinParticipant = useCallback(async () => {
    setIsSpinning(true);

    // 当選済みでない参加者リスト
    const available = participants.filter((p) => !drawnParticipants.has(p));
    if (available.length === 0) {
      setIsSpinning(false);
      return; // すべての参加者が当選済み
    }

    // スロット風アニメーション
    const spinDuration = 800;
    const itemDuration = 50;
    const itemCount = Math.floor(spinDuration / itemDuration);

    let currentIndex = 0;
    const spinInterval = setInterval(() => {
      const randomParticipant = participants[Math.floor(Math.random() * participants.length)];
      setCurrentParticipant(randomParticipant);
      currentIndex++;

      if (currentIndex >= itemCount) {
        clearInterval(spinInterval);

        // 利用可能な参加者から選ぶ
        const selected = available[Math.floor(Math.random() * available.length)];
        setCurrentParticipant(selected);
        // 注意: phaseは'spinning'のままにする（次はお題スロット）
        setIsSpinning(false);
      }
    }, itemDuration);
  }, [participants, drawnParticipants]);

  const spinTopic = useCallback(async () => {
    setIsSpinning(true);

    // 当選済みでないお題リスト
    const available = STAGE0_TOPICS.filter((t) => !drawnTopicIds.has(t.id));
    if (available.length === 0) {
      setIsSpinning(false);
      return; // すべてのお題が当選済み
    }

    // スロット風アニメーション
    const spinDuration = 800;
    const itemDuration = 50;
    const itemCount = Math.floor(spinDuration / itemDuration);

    let currentIndex = 0;
    const spinInterval = setInterval(() => {
      const randomTopic = STAGE0_TOPICS[Math.floor(Math.random() * STAGE0_TOPICS.length)];
      setCurrentTopic(randomTopic);
      currentIndex++;

      if (currentIndex >= itemCount) {
        clearInterval(spinInterval);

        // 利用可能なお題から選ぶ
        const selected = available[Math.floor(Math.random() * available.length)];
        setCurrentTopic(selected);

        // 当選済みに追加（spinTopic完了時に参加者も追加）
        setDrawnTopicIds((prev) => new Set([...prev, selected.id]));
        if (currentParticipant) {
          setDrawnParticipants((prev) => new Set([...prev, currentParticipant]));
        }

        // デバッグログ
        console.log('[STAGE0 topic spin complete]', {
          selected,
          selectedParticipant: currentParticipant,
          phase: 'about to set result',
        });

        // お題選択完了 → 結果画面へ遷移
        setPhase('result');
        setIsSpinning(false);
      }
    }, itemDuration);
  }, [currentParticipant, drawnTopicIds]);

  const nextRound = useCallback(() => {
    // 全員が1回ずつ話したかチェック
    if (drawnParticipants.size >= participants.length) {
      setPhase('closing');
    } else {
      // 次の参加者へ
      setCurrentParticipant(null);
      setCurrentTopic(null);
      setPhase('spinning');
    }
  }, [drawnParticipants.size, participants.length]);

  const anotherRound = useCallback(() => {
    // リセット（参加者はそのまま）
    setDrawnParticipants(new Set());
    setDrawnTopicIds(new Set());
    setCurrentParticipant(null);
    setCurrentTopic(null);
    setPhase('spinning');
  }, []);

  const goHome = useCallback(() => {
    // ホームへ戻る
    window.location.href = '/';
  }, []);

  return {
    participants,
    addParticipant,
    removeParticipant,
    phase,
    setPhase,
    currentParticipant,
    currentTopic,
    drawnParticipants,
    drawnTopicIds,
    spinCombined,
    spinParticipant,
    spinTopic,
    nextRound,
    anotherRound,
    goHome,
    isSpinning,
  };
}
