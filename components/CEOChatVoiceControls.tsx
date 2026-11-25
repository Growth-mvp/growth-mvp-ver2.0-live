// /components/CEOChatVoiceControls.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2, VolumeX } from 'lucide-react';
import {
  getRecognitionCtor,
  isSpeechOutputSupported,
  microphoneErrorMessage,
  probeMicrophone,
  stopSpeaking,
  type RecognitionLike,
} from '@/lib/voice/browserSpeech';
import { readVoiceConsent, writeVoiceConsent } from '@/lib/voice/voiceSettings';

type Props = {
  userId: string;
  disabled: boolean;
  onTranscript: (text: string) => void;
  autoRead: boolean;
  onAutoReadChange: (on: boolean) => void;
  speaking: boolean;
};

const BUTTON_CLS =
  'inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400';

export default function CEOChatVoiceControls({ userId, disabled, onTranscript, autoRead, onAutoReadChange, speaking }: Props) {
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [outputSupported, setOutputSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [consented, setConsented] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const transcriptRef = useRef(onTranscript);

  useEffect(() => {
    transcriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    setRecognitionSupported(getRecognitionCtor() !== null);
    setOutputSupported(isSpeechOutputSupported());
  }, []);

  useEffect(() => {
    setConsented(readVoiceConsent(window.localStorage, userId));
    setConsentPending(false);
  }, [userId]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const startListening = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setMessage(null);
    const recognition = new Ctor();
    recognition.lang = 'ja-JP';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[event.results.length - 1]?.[0]?.transcript?.trim() ?? '';
      if (text) transcriptRef.current(text);
      else setMessage('音声が聞き取れませんでした。もう一度お試しください。');
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      void (async () => {
        const probe = event.error === 'not-allowed' ? await probeMicrophone() : null;
        console.warn('[voice] recognition error', { code: event.error, probe });
        setMessage(microphoneErrorMessage(event.error, probe));
      })();
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setMessage('音声入力を開始できませんでした。文字でご入力ください。');
    }
  };

  const onMicClick = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    if (!consented) {
      setConsentPending(true);
      return;
    }
    startListening();
  };

  const agreeAndStart = () => {
    writeVoiceConsent(window.localStorage, userId);
    setConsented(true);
    setConsentPending(false);
    startListening();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {recognitionSupported ? (
        <button
          type="button"
          onClick={onMicClick}
          disabled={disabled && !listening}
          aria-pressed={listening}
          className={BUTTON_CLS}
        >
          {listening ? <Square size={12} aria-hidden /> : <Mic size={12} aria-hidden />}
          {listening ? '録音を停止' : '音声で入力'}
        </button>
      ) : (
        <span className="text-[11px] text-zinc-500">このブラウザは音声入力に未対応です。文字でご入力ください。</span>
      )}
      {outputSupported ? (
        <button type="button" onClick={() => onAutoReadChange(!autoRead)} aria-pressed={autoRead} className={BUTTON_CLS}>
          {autoRead ? <Volume2 size={12} aria-hidden /> : <VolumeX size={12} aria-hidden />}
          回答を読み上げ：{autoRead ? 'オン' : 'オフ'}
        </button>
      ) : null}
      {speaking ? (
        <button type="button" onClick={stopSpeaking} className={BUTTON_CLS}>
          <Square size={12} aria-hidden />
          読み上げを停止
        </button>
      ) : null}
      {listening ? (
        <span role="status" className="flex items-center gap-1 text-[12px] text-rose-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-rose-600" aria-hidden />
          録音中です。話し終わると自動で止まります。
        </span>
      ) : null}
      {message ? (
        <p role="status" className="w-full text-[12px] text-bluegray-deep">
          {message}
        </p>
      ) : null}
      {consentPending ? (
        <div role="dialog" aria-label="音声入力の同意" className="w-full space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-[12px] leading-5 text-zinc-800">
          <p>
            音声入力では、話した内容がブラウザ提供元などの外部の音声認識サービスで文字に変換される場合があります。
            マイクは「録音中」の表示がある間だけ使われます。変換された文字は入力欄に入るだけで、送信するまでAIには届きません。
            同意しない場合は、文字で入力してください。
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={agreeAndStart} className="rounded-md bg-accent-action px-3 py-1 text-white hover:bg-accent-hover">
              同意して録音を開始
            </button>
            <button type="button" onClick={() => setConsentPending(false)} className={BUTTON_CLS}>
              やめる
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
