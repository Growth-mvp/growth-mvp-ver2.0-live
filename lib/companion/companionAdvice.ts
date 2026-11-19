/* 経営支援（③）の助言を依頼するための文言と、サーバー側の規則。
 * 助言は保存済みの内容だけを根拠にし、根拠のない数値や決定の断定を防ぐ。 */

import type { Milestone } from './companionMilestones';
import { MILESTONE_LABEL } from './companionMilestones';

export const COMPANION_MILESTONES: readonly Milestone[] = ['ANALYSIS', 'GENERATE', 'CONFIRM'];

export const ADVICE_FOCUS: readonly string[] = [
  '顧客が自社を選ぶ理由',
  '顧客の未解決課題と勝ち筋',
  '全社戦略と事業・部門戦略の整合性',
  '部門間の認識のズレとすり合わせ',
  '目的と手段の区別',
  '社員の主体的な判断と行動',
];

const NEXT_QUESTION: Record<Milestone, string> = {
  ANALYSIS: '論点のうち、どれを戦略の中心に据えるべきか',
  GENERATE: '生成された戦略のどの主張に、根拠が足りないか',
  CONFIRM: '確定した戦略を、部門の誰がどの行動で実行するか',
};

/** 利用者への依頼文（チャットの送信内容として使う） */
export function buildMilestonePrompt(milestone: Milestone): string {
  return [
    `（自律伴走の助言）${MILESTONE_LABEL[milestone]}。`,
    '保存済みの情報だけを根拠に、次の観点から3点以内で助言してください。',
    `観点：${ADVICE_FOCUS.join('、')}。`,
    '各点は、根拠（どの項目の値か）を添えてください。',
    '根拠がない内容は「未登録」と書き、数値を作らないでください。',
    '事実・計画・推計・仮説を区別して書いてください。',
    '判断は利用者に委ね、決定を断定しないでください。',
    `最後に、利用者が考えるべき問いを1つ添えてください（例：${NEXT_QUESTION[milestone]}）。`,
  ].join('\n');
}

/** サーバーが応答を作るときに追加する規則（meta.companion がある時だけ使う） */
export function buildMilestoneGuard(milestone: Milestone): string {
  return [
    '【自律伴走の助言の規則】',
    `この応答は「${MILESTONE_LABEL[milestone]}」という節目での助言です。`,
    '提示された保存済みのデータだけを根拠にしてください。根拠のない数値・事実を作らないでください。',
    '未登録・未算定の項目は、そのように明記してください。',
    '判断は利用者に委ね、決定を断定しないでください。操作手順の説明は含めないでください。',
    '最大3点、各点は根拠（どの項目の値か）を添えてください。',
  ].join('\n');
}

export function isMilestone(v: unknown): v is Milestone {
  return typeof v === 'string' && (COMPANION_MILESTONES as readonly string[]).includes(v);
}
