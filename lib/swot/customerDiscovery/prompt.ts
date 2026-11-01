import type { Buyer } from './buyers';

/** 顧客課題の件数の上限（購入者ごと・全体）。件数のノルマではなく上限 */
export const DISCOVERY_PER_BUYER_MAX = 3;
export const DISCOVERY_TOTAL_MAX = 16;
/** 1件の課題文の上限（字数の形式検査のみ） */
export const DISCOVERY_TEXT_MAX = 200;

/** 課題生成の指示（会社の製品・強み・能力は渡さない。購入者の立場と仕事上の目的から考える） */
export const DISCOVERY_INSTRUCTIONS = `あなたは、購入者の立場からまだ十分に満たされていない課題を発見する専門家です。

以下の購入者（番号付き）それぞれについて、次の問いに答えてください。

「この人・企業は、自分の事業や仕事を成功させるうえで、何に困っているのか？」

経営、利益、顧客、従業員、投資判断、将来への不安など、商品・サービスに限定されない課題を幅広く考えてください。
特に、本人が仕方がないと諦めていること、従来の方法では解決できていないこと、顧客や現場の声として表面化しにくい問題を重視してください。
購入者の成果に影響する関係者（利用者、現場、購入者の顧客など）の課題も、必要な場合は含めてください（その場合は subject を stakeholder にする）。

進め方:
- 根拠を説明できる課題がある購入者には、必ず1件以上書いてください。
- 同じ主題（同じ種類の困りごと）を、複数の購入者に書かないでください。ただし、立場や状況によって理由・影響が明確に異なる場合に限り、それぞれ別の課題として書いてください。

各項目は、誰が、どの場面で、何に困っているのかが分かる具体的な一文にしてください。
事実として確認していない内容は仮説として扱ってください。
入力に示された購入者以外の購入者を作らないでください。根拠を説明できる課題が思い浮かばない購入者だけ0件でかまいません。
事業機会・施策・提供形態・特定の企業の能力を書かないでください。

【出力】
JSONのみ。problems: 各項目は buyer_ref（購入者の番号）、subject（buyer または stakeholder）、text（誰が、どの場面で、何に困っているかの一文）、why_unsolved（現在の解決手段で満たされない理由。分からなければ「不明」）。
購入者ごとに最大${DISCOVERY_PER_BUYER_MAX}件、全体で最大${DISCOVERY_TOTAL_MAX}件。`;

export const DISCOVERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['problems'],
  properties: {
    problems: {
      type: 'array',
      maxItems: DISCOVERY_TOTAL_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['buyer_ref', 'subject', 'text', 'why_unsolved'],
        properties: {
          buyer_ref: { type: 'integer' },
          subject: { type: 'string', enum: ['buyer', 'stakeholder'] },
          text: { type: 'string' },
          why_unsolved: { type: 'string' },
        },
      },
    },
  },
} as const;

/** 課題生成の入力（購入者の番号と名称だけ。会社の製品・強み・事業概要は含めない） */
export function buildDiscoveryInput(buyers: readonly Buyer[]): string {
  const list = buyers.map((b) => `${b.ref}. ${b.label}`).join('\n');
  return `# 購入者（番号付き）\n${list}`;
}
