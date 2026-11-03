// lib/autoModeRouter.ts
// 最後のユーザー発話から help（操作・製品説明）か advisor（経営相談）かを判定する

import { classifyQuestion } from '@/lib/operationKnowledge/guidance';

export type AutoMode = 'help' | 'advisor';

export interface AutoModeResult {
  mode: AutoMode;
  confidence: number;
  reasons: string[];
}

const PRODUCT_QUESTION =
  /(GROWTH|growth|STAGE\s*[1-6]|ステージ\s*[1-6]).*(とは|って何|どんな|何ができ|できること|何をする)|どんなツール|何をするツール/i;
const TROUBLESHOOT =
  /エラー|バグ|直らない|(保存|ログイン|読み込|表示|画面|ボタン)[^。？?]{0,8}(できない|されない|動かない|消えた)/;
const JUDGMENT = /べきか|べきですか|どちら|優先|判断|どう思/;
const STATUS_QUERY = /予定|いつまで|誰が|担当|期限|進捗|どうなって/;
const UI_CUE = /この画面|画面|欄|ボタン|タブ|見当たら|使い方|保存|次は|次に|初めて|はじめて|何から|どこ/;

export function detectAutoMode(args: {
  lastUserText: string;
  stageHint?: string | null;
}): AutoModeResult {
  const text = args.lastUserText ?? '';

  if (text.trim().length === 0) {
    return { mode: 'advisor', confidence: 0.55, reasons: ['empty text, default to advisor'] };
  }

  if (PRODUCT_QUESTION.test(text)) {
    return { mode: 'help', confidence: 0.95, reasons: ['forced:product_question'] };
  }

  if (TROUBLESHOOT.test(text)) {
    return { mode: 'help', confidence: 0.9, reasons: ['troubleshoot'] };
  }

  const kind = classifyQuestion(text);
  const statusQuery = STATUS_QUERY.test(text) && !UI_CUE.test(text);
  if (kind === 'operation' && !JUDGMENT.test(text) && !statusQuery) {
    return { mode: 'help', confidence: 0.85, reasons: [`operation:${kind}`] };
  }

  return { mode: 'advisor', confidence: 0.8, reasons: [`advisory:${kind}`] };
}
