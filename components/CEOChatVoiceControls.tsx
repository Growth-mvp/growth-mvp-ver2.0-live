// /components/CEOChatVoiceControls.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { getRecognitionCtor, isSpeechOutputSupported } from '@/lib/voice/browserSpeech';
import type { ConversationStatus } from '@/lib/voice/conversation';

type Props = {
  status: ConversationStatus;
  notice: string | null;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  autoRead: boolean;
  onAutoReadChange: (on: boolean) => void;
  speaking: boolean;
  onStopReading: () => void;
};

type InputMode = 'voice' | 'text';

const STATUS_LABEL: Record<ConversationStatus, string> = {
  off: '会話は止まっています',
  listening: '聞いています',
  thinking: '考えています',
  speaking: 'お答えしています',
};

const STATUS_DOT: Record<ConversationStatus, string> = {
  off: 'bg-zinc-300',
  listening: 'bg-emerald-500 animate-pulse',
  thinking: 'bg-amber-500 animate-pulse',
  speaking: 'bg-sky-500 animate-pulse',
};

const SMALL_BUTTON =
  'inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400';

export default function CEOChatVoiceControls({
  status,
  notice,
  disabled,
  onStart,
  onStop,
  autoRead,
  onAutoReadChange,
  speaking,
  onStopReading,
}: Props) {
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [outputSupported, setOutputSupported] = useState(false);
  const [mode, setMode] = useState<InputMode>('voice');

  useEffect(() => {
    const supported = getRecognitionCtor() !== null;
    setVoiceSupported(supported);
    setOutputSupported(isSpeechOutputSupported());
    if (!supported) setMode('text');
  }, []);

  const switchMode = (next: InputMode) => {
    if (next === 'text' && status !== 'off') onStop();
    setMode(next);
  };

  const inVoice = voiceSupported && mode === 'voice';

  return (
    <section aria-label="音声と文字の入力" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {voiceSupported ? (
          <div role="tablist" aria-label="入力方法" className="inline-flex rounded-full bg-zinc-100 p-1 text-[12px]">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'voice'}
              onClick={() => switchMode('voice')}
              className={`rounded-full px-3 py-1 ${mode === 'voice' ? 'bg-white font-semibold text-zinc-900 shadow-sm' : 'text-zinc-600'}`}
            >
              音声で話す
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'text'}
              onClick={() => switchMode('text')}
              className={`rounded-full px-3 py-1 ${mode === 'text' ? 'bg-white font-semibold text-zinc-900 shadow-sm' : 'text-zinc-600'}`}
            >
              文字で入力
            </button>
          </div>
        ) : (
          <span className="text-[12px] text-zinc-500">このブラウザは音声入力に未対応です。文字でご入力ください。</span>
        )}
        {outputSupported && !inVoice ? (
          <button type="button" onClick={() => onAutoReadChange(!autoRead)} aria-pressed={autoRead} className={SMALL_BUTTON}>
            {autoRead ? <Volume2 size={13} aria-hidden /> : <VolumeX size={13} aria-hidden />}
            回答を読み上げ：{autoRead ? 'オン' : 'オフ'}
          </button>
        ) : null}
      </div>

      {inVoice ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-4">
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-[14px] font-medium text-zinc-800">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
            {STATUS_LABEL[status]}
          </div>
          {status === 'off' ? (
            <>
              <button
                type="button"
                onClick={onStart}
                disabled={disabled}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent-action px-4 py-3 text-[15px] font-semibold text-white hover:bg-accent-hover disabled:bg-zinc-300"
              >
                <Mic size={18} aria-hidden />
                会話を始める
              </button>
              <p className="text-center text-[11px] leading-5 text-zinc-500">
                話した内容は、ブラウザ提供元などの外部の音声認識サービスで文字に変換される場合があります。マイクは会話中だけ使われ、「会話を終了する」で止まります。
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={onStop}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-zinc-300 bg-white px-4 py-3 text-[15px] font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              <Square size={16} aria-hidden />
              会話を終了する
            </button>
          )}
        </div>
      ) : null}

      {speaking && status === 'off' ? (
        <button type="button" onClick={onStopReading} className={SMALL_BUTTON}>
          <Square size={12} aria-hidden />
          読み上げを停止
        </button>
      ) : null}
      {notice ? (
        <p role="status" className="text-[12px] leading-5 text-bluegray-deep">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
