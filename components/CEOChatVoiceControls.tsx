// /components/CEOChatVoiceControls.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Keyboard, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { getRecognitionCtor, isSpeechOutputSupported } from '@/lib/voice/browserSpeech';
import type { ConversationStatus } from '@/lib/voice/conversation';
import type { ReplyMode } from '@/lib/voice/voiceSettings';

export type InputMode = 'voice' | 'text';

type Props = {
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;
  status: ConversationStatus;
  notice: string | null;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  replyMode: ReplyMode;
  onReplyModeChange: (mode: ReplyMode) => void;
  autoRead: boolean;
  onAutoReadChange: (on: boolean) => void;
  speaking: boolean;
  onStopReading: () => void;
};

const STATUS_LABEL: Record<ConversationStatus, string> = {
  off: '会話は止まっています',
  listening: '聞いています',
  thinking: '考えています',
  speaking: 'お答えしています',
  paused: '文字で回答しました',
};

const STATUS_DOT: Record<ConversationStatus, string> = {
  off: 'bg-zinc-300',
  listening: 'bg-emerald-500',
  thinking: 'bg-amber-500 animate-pulse',
  speaking: 'bg-sky-500 animate-pulse',
  paused: 'bg-zinc-400',
};

const SMALL_BUTTON =
  'inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400';

const ICON_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 transition hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';
const ICON_BUTTON_ON = 'bg-white text-zinc-900 shadow-sm';

const MAIN_BUTTON =
  'flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[16px] font-semibold';
const PRIMARY = `${MAIN_BUTTON} bg-accent-action text-white hover:bg-accent-hover disabled:bg-zinc-300`;
const SECONDARY = `${MAIN_BUTTON} border-2 border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50`;

export default function CEOChatVoiceControls({
  inputMode,
  onInputModeChange,
  status,
  notice,
  disabled,
  onStart,
  onStop,
  onResume,
  replyMode,
  onReplyModeChange,
  autoRead,
  onAutoReadChange,
  speaking,
  onStopReading,
}: Props) {
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [outputSupported, setOutputSupported] = useState(false);

  useEffect(() => {
    const supported = getRecognitionCtor() !== null;
    setVoiceSupported(supported);
    setOutputSupported(isSpeechOutputSupported());
    if (!supported) onInputModeChange('text');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMode = (next: InputMode) => {
    if (next === 'text' && status !== 'off') onStop();
    onInputModeChange(next);
  };

  const inVoice = voiceSupported && inputMode === 'voice';

  return (
    <section aria-label="音声と文字の入力" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {voiceSupported ? (
          <div role="group" aria-label="入力方法" className="inline-flex gap-1 rounded-full bg-zinc-100 p-1">
            <button
              type="button"
              aria-label="音声で話す"
              title="音声で話す"
              aria-pressed={inputMode === 'voice'}
              onClick={() => switchMode('voice')}
              className={`${ICON_BUTTON} ${inputMode === 'voice' ? ICON_BUTTON_ON : ''}`}
            >
              <Mic size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="文字で入力"
              title="文字で入力"
              aria-pressed={inputMode === 'text'}
              onClick={() => switchMode('text')}
              className={`${ICON_BUTTON} ${inputMode === 'text' ? ICON_BUTTON_ON : ''}`}
            >
              <Keyboard size={16} aria-hidden />
            </button>
          </div>
        ) : (
          <span className="text-[12px] text-zinc-500">このブラウザは音声入力に未対応です。文字でご入力ください。</span>
        )}
        {inVoice ? (
          <div role="group" aria-label="回答方法" className="inline-flex gap-1 rounded-full bg-zinc-100 p-1">
            <button
              type="button"
              aria-label="音声＋文字で回答"
              title="音声＋文字：回答を読み上げ、文字でも表示"
              aria-pressed={replyMode === 'voice-and-text'}
              onClick={() => onReplyModeChange('voice-and-text')}
              className={`${ICON_BUTTON} ${replyMode === 'voice-and-text' ? ICON_BUTTON_ON : ''}`}
            >
              <Volume2 size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="文字のみで回答"
              title="文字のみ：回答は文字だけで表示"
              aria-pressed={replyMode === 'text-only'}
              onClick={() => onReplyModeChange('text-only')}
              className={`${ICON_BUTTON} ${replyMode === 'text-only' ? ICON_BUTTON_ON : ''}`}
            >
              <VolumeX size={16} aria-hidden />
            </button>
          </div>
        ) : outputSupported ? (
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
            {status === 'listening' ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
                録音中
              </span>
            ) : null}
          </div>
          {status === 'off' ? (
            <>
              <button type="button" onClick={onStart} disabled={disabled} className={PRIMARY}>
                <Mic size={18} aria-hidden />
                会話を始める
              </button>
              <p className="text-center text-[11px] leading-5 text-zinc-500">
                話した内容は、外部の音声認識サービスで文字に変換される場合があります。
              </p>
            </>
          ) : status === 'paused' ? (
            <div className="flex w-full flex-col gap-2">
              <button type="button" onClick={onResume} disabled={disabled} className={PRIMARY}>
                <Mic size={18} aria-hidden />
                次の質問を話す
              </button>
              <button type="button" onClick={onStop} className={SECONDARY}>
                <Square size={14} aria-hidden />
                会話を終了する
              </button>
            </div>
          ) : (
            <button type="button" onClick={onStop} className={SECONDARY}>
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
