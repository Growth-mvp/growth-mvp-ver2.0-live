'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceConversation, type ConversationStatus } from '@/lib/voice/conversation';
import { getRecognitionCtor, microphoneErrorMessage, probeMicrophone, speakChunks } from '@/lib/voice/browserSpeech';
import { toSpeakableChunks } from '@/lib/voice/speechText';
import { DEFAULT_REPLY_MODE, type ReplyMode } from '@/lib/voice/voiceSettings';

const HIDDEN_MESSAGE = '画面が非表示になったため、会話を終了しました。再開するには「会話を始める」を押してください。';

/* 音声会話の状態をReactにつなぐ。onSpeech は利用者の発言を送り、AIの回答（読み上げる文）を返す（送れなければ null） */
export function useVoiceConversation(onSpeech: (text: string) => Promise<string | null>) {
  const [status, setStatus] = useState<ConversationStatus>('off');
  const [notice, setNotice] = useState<string | null>(null);
  const [replyMode, setReplyModeState] = useState<ReplyMode>(DEFAULT_REPLY_MODE);
  const onSpeechRef = useRef(onSpeech);
  const controllerRef = useRef<VoiceConversation | null>(null);

  useEffect(() => {
    onSpeechRef.current = onSpeech;
  }, [onSpeech]);

  if (controllerRef.current === null) {
    controllerRef.current = new VoiceConversation({
      isSupported: () => getRecognitionCtor() !== null,
      createRecognizer: () => {
        const Ctor = getRecognitionCtor();
        return Ctor ? new Ctor() : null;
      },
      speakReply: (text, handlers) => speakChunks(toSpeakableChunks(text), { onEnd: handlers.onEnd }),
      onStatus: (next) => setStatus(next),
      onUtterance: (text) => {
        void onSpeechRef
          .current(text)
          .catch(() => null)
          .then((answer) => controllerRef.current?.replyDone(answer));
      },
      describeError: async (code) => {
        const probe = code === 'not-allowed' ? await probeMicrophone() : null;
        /* 原因の切り分けに使うのは、エラーの種類と判定結果だけ（音声の内容は含めない） */
        console.warn('[voice] recognition error', { code, probe });
        return microphoneErrorMessage(code, probe);
      },
      notify: (message) => setNotice(message),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    });
  }

  const start = useCallback(() => {
    setNotice(null);
    controllerRef.current?.start();
  }, []);

  const stop = useCallback((message?: string) => {
    controllerRef.current?.stop(message);
  }, []);

  const resume = useCallback(() => {
    setNotice(null);
    controllerRef.current?.resume();
  }, []);

  const setReplyMode = useCallback((mode: ReplyMode) => {
    setReplyModeState(mode);
    controllerRef.current?.setReplyMode(mode);
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) controllerRef.current?.stop(HIDDEN_MESSAGE);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      controllerRef.current?.stop();
    };
  }, []);

  return { status, notice, replyMode, start, stop, resume, setReplyMode, clearNotice: () => setNotice(null) };
}
