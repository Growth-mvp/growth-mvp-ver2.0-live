// /lib/questionSeeds.ts
// ----------------------------------------------------
// 目的: GROWTH哲学に基づく「良問シード」プール
// 用途: /app/api/generate-question/route.ts の参照元
// ----------------------------------------------------

export type SeedCategory =
  | 'future'
  | 'customer'
  | 'strength'
  | 'bottleneck'
  | 'organization'
  | 'focus';

export const SEED_POOL: Record<number, { category: SeedCategory; text: string }[]> = {
  /* ========= 第2章：未来の方向性と価値創造 ========= */
  2: [
    // ──────────── ① 未来の環境 ────────────
    {
      category: 'future',
      text: 'この3年で、お客様や市場はどんな変化を迎えると思いますか？',
    },
    {
      category: 'future',
      text: '技術や社会の変化の中で、私たちの業界はどんな方向に進みそうですか？',
    },
    {
      category: 'future',
      text: '今の常識が、近い将来通用しなくなるとしたら、それはどんな部分だと思いますか？',
    },

    // ──────────── ② 顧客価値 ────────────
    {
      category: 'customer',
      text: 'お客様が「本当に助かった」と感じる瞬間は、どんな時でしょうか？',
    },
    {
      category: 'customer',
      text: 'これからのお客様は、どんなことに時間やお金を使いたいと感じるでしょうか？',
    },
    {
      category: 'customer',
      text: '私たちが提供している価値を一言で表すと、何になりますか？',
    },

    // ──────────── ③ 強みと集中領域 ────────────
    {
      category: 'strength',
      text: 'これからの時代にこそ活かせる、当社ならではの強みは何でしょうか？',
    },
    {
      category: 'strength',
      text: 'その強みをもっと伸ばすために、今どんな投資が必要だと思いますか？',
    },
    {
      category: 'strength',
      text: '「ここだけは絶対に負けない」と言える領域はどこですか？',
    },

    // ──────────── ④ 課題・ボトルネック ────────────
    {
      category: 'bottleneck',
      text: 'いま、成果を出す上で一番の壁になっているのは何ですか？',
    },
    {
      category: 'bottleneck',
      text: 'チームが挑戦をためらう原因は、どんな構造や習慣にあると思いますか？',
    },
    {
      category: 'bottleneck',
      text: '「もしここが解消すれば、一気に伸びる」と思う部分はありますか？',
    },

    // ──────────── ⑤ 組織・文化変革 ────────────
    {
      category: 'organization',
      text: '社員が心からやる気を感じる瞬間は、どんな時でしょうか？',
    },
    {
      category: 'organization',
      text: '変革を進める上で、社内にどんな誤解や抵抗が起きそうですか？',
    },
    {
      category: 'organization',
      text: '全員が同じ方向を向くために必要な共通言葉は何だと思いますか？',
    },

    // ──────────── ⑥ 集中とやめること ────────────
    {
      category: 'focus',
      text: 'この一年で「もうやめてもいい」と思う活動はありますか？',
    },
    {
      category: 'focus',
      text: 'やめることで、何にもっと集中できそうですか？',
    },
    {
      category: 'focus',
      text: '「これをやり続ける限り、成長できない」と感じるものは何ですか？',
    },
  ],
};
