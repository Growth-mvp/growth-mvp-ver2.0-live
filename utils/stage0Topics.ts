// STAGE0: 会議前の一息 - トピックリスト

export interface Topic {
  id: string;
  category: 'team' | 'culture' | 'challenge' | 'vision';
  text: string;
}

export const STAGE0_TOPICS: Topic[] = [
  // ===== A. チーム・人間関係 型 (15件) =====
  {
    id: 'team-01',
    category: 'team',
    text: '最近、チームメンバーの意外な一面を発見したことは？',
  },
  {
    id: 'team-02',
    category: 'team',
    text: '同じチームの人で「この人に助けられた」という経験は？',
  },
  {
    id: 'team-03',
    category: 'team',
    text: 'チームメンバーで「この人のここが好きだな」と思う人は？',
  },
  {
    id: 'team-04',
    category: 'team',
    text: 'チーム内で起きた、思わず笑ってしまった出来事は？',
  },
  {
    id: 'team-06',
    category: 'team',
    text: 'チームで協力できたな、うまく行ったなと思う瞬間は？',
  },
  {
    id: 'team-07',
    category: 'team',
    text: 'この人だから相談できる、という信頼できる同僚は？',
  },
  {
    id: 'team-09',
    category: 'team',
    text: 'チームメンバーとのやり取りで、心に残った言葉は？',
  },
  {
    id: 'team-13',
    category: 'team',
    text: 'チーム内で「ここはいいな」と思うルールや文化は？',
  },
  {
    id: 'team-15',
    category: 'team',
    text: 'チーム内で一緒にいると、ホッとする人は？',
  },
  {
    id: 'team-16',
    category: 'team',
    text: '最近、メンバーから教えてもらったことや学んだことは？',
  },
  {
    id: 'team-18',
    category: 'team',
    text: 'チームメンバーとのやり取りで「さすがだな」と感じたことは？',
  },
  {
    id: 'team-20',
    category: 'team',
    text: 'チームメンバーの多様性や違いで「いいな」と思うことは？',
  },
  {
    id: 'team-21',
    category: 'team',
    text: '誰かに助けられて、「人ってありがたいな」と感じた経験は？',
  },
  {
    id: 'team-22',
    category: 'team',
    text: '信頼されていると感じる瞬間は、どんな時？',
  },
  {
    id: 'team-23',
    category: 'team',
    text: '誰かの笑顔で、自分も気持ちが変わったことはありますか？',
  },

  // ===== B. 仕事・会社文化 型 (10件) =====
  {
    id: 'culture-02',
    category: 'culture',
    text: '自分がこの仕事で密かに大事にしていることは？',
  },
  {
    id: 'culture-07',
    category: 'culture',
    text: '最近の仕事を通じて「やっぱりこれが好きだ」と感じたことは？',
  },
  {
    id: 'culture-09',
    category: 'culture',
    text: '業務を通じて「誰かの役に立てた」と感じたことは？',
  },
  {
    id: 'culture-13',
    category: 'culture',
    text: 'この仕事を選んだ理由は？（今改めて考えると）',
  },
  {
    id: 'culture-15',
    category: 'culture',
    text: 'この会社で学べたスキル・視点で一番は？',
  },
  {
    id: 'culture-16',
    category: 'culture',
    text: '最近の業務で「やりがい」を感じたことは？',
  },
  {
    id: 'culture-19',
    category: 'culture',
    text: 'この会社で「自分らしく働けている」と感じることは？',
  },
  {
    id: 'culture-20',
    category: 'culture',
    text: '仕事を通じて「この価値観は大切だ」と改めて感じたことは？',
  },
  {
    id: 'culture-21',
    category: 'culture',
    text: 'キャリアの中で一番成長できたのはどんな経験？',
  },
  {
    id: 'culture-22',
    category: 'culture',
    text: '仕事をしていて、自分らしさが出ていると感じるのはどんな時？',
  },

  // ===== C. if・選択・ビジョン型 (12件) =====
  {
    id: 'challenge-02',
    category: 'challenge',
    text: 'もし異なる部門で1週間働いてみたら、何が見えると思う？',
  },
  {
    id: 'challenge-13',
    category: 'challenge',
    text: '1年後の自分がどうなっていたら理想だと思う？',
  },
  {
    id: 'challenge-15',
    category: 'challenge',
    text: '海外での仕事機会があったら、行きたい国は？理由は？',
  },
  {
    id: 'challenge-16',
    category: 'challenge',
    text: 'もし10年後のビジョンを描くなら、どんな状況にいたい？',
  },
  {
    id: 'challenge-18',
    category: 'challenge',
    text: 'もし業界の課題に取り組めたら、何に挑戦したい？',
  },
  {
    id: 'challenge-20',
    category: 'challenge',
    text: 'もし完全にリセットできたら、どんなキャリアを歩みたい？',
  },
  {
    id: 'challenge-21',
    category: 'challenge',
    text: '人生で後悔しないために、今からできることは何？',
  },
  {
    id: 'challenge-22',
    category: 'challenge',
    text: '自分にとって本当の成功とは、どういう状態？',
  },
  {
    id: 'challenge-23',
    category: 'challenge',
    text: '5年後、どんな自分でいたいですか？',
  },
  {
    id: 'challenge-24',
    category: 'challenge',
    text: 'もし時間とお金に制限がなかったら、人生で何がしたい？',
  },
  {
    id: 'challenge-25',
    category: 'challenge',
    text: 'これからの人生で一番大事にしたいことは何？',
  },
  {
    id: 'challenge-26',
    category: 'challenge',
    text: '自分の人生で譲れない原則・信念は何ですか？',
  },

  // ===== D. 告白・失敗自慢・価値観型 (45件) =====
  {
    id: 'vision-01',
    category: 'vision',
    text: '実は誰にも言ってない、ちょっとしたマイルールは？',
  },
  {
    id: 'vision-02',
    category: 'vision',
    text: '最近やらかした、笑い話レベルの失敗は？',
  },
  {
    id: 'vision-03',
    category: 'vision',
    text: '実はちょっとだけ得意なことは？',
  },
  {
    id: 'vision-04',
    category: 'vision',
    text: '人には言ってない小さな自慢は？',
  },
  {
    id: 'vision-05',
    category: 'vision',
    text: '一人の時にだけやってる、地味に幸せな習慣は？',
  },
  {
    id: 'vision-06',
    category: 'vision',
    text: '意外かもしれないけど、実は好きなものは？',
  },
  {
    id: 'vision-07',
    category: 'vision',
    text: '仕事外で最近ハマってることは？',
  },
  {
    id: 'vision-08',
    category: 'vision',
    text: '実は苦手だけど、何とか工夫して乗り切ってることは？',
  },
  {
    id: 'vision-09',
    category: 'vision',
    text: 'あるあるだけど「自分もそう！」という話は？',
  },
  {
    id: 'vision-10',
    category: 'vision',
    text: '最近、思わず「あ、ダメだ」と気づいたクセは？',
  },
  {
    id: 'vision-11',
    category: 'vision',
    text: 'これだけは譲れない、というこだわりは？',
  },
  {
    id: 'vision-12',
    category: 'vision',
    text: '子どもの頃の夢や思い出で、今も影響してることは？',
  },
  {
    id: 'vision-13',
    category: 'vision',
    text: '実は自分、○○なんです、という意外な側面は？',
  },
  {
    id: 'vision-14',
    category: 'vision',
    text: '最近、「昔の自分だったら違う選択をしてたな」という瞬間は？',
  },
  {
    id: 'vision-15',
    category: 'vision',
    text: '家族や友人に言ったら驚かれそうなことは？',
  },
  {
    id: 'vision-16',
    category: 'vision',
    text: 'チームの誰も知らないであろう、意外な趣味は？',
  },
  {
    id: 'vision-17',
    category: 'vision',
    text: '実は完璧主義でない自分が許容できてることは？',
  },
  {
    id: 'vision-18',
    category: 'vision',
    text: '普段は言わないけど、心の中で「これいいな」と思ってることは？',
  },
  {
    id: 'vision-19',
    category: 'vision',
    text: 'もしチーム内でランダムに選ばれたら、びっくりされそうなことは？',
  },
  {
    id: 'vision-20',
    category: 'vision',
    text: '自分のペースや歩み方で、こだわってる部分は？',
  },
  {
    id: 'vision-21',
    category: 'vision',
    text: '人生で大事にしていることは何ですか？',
  },
  {
    id: 'vision-22',
    category: 'vision',
    text: '自分らしく生きるために、何が一番必要？',
  },
  {
    id: 'vision-23',
    category: 'vision',
    text: '10年前の自分と今で、一番変わったことは？',
  },
  {
    id: 'vision-24',
    category: 'vision',
    text: '人付き合いで大切にしていることは何？',
  },
  {
    id: 'vision-25',
    category: 'vision',
    text: '自分の強みだと思うところは？',
  },
  {
    id: 'vision-26',
    category: 'vision',
    text: '最近、自分の価値観が揺らいだことはありますか？',
  },
  {
    id: 'vision-27',
    category: 'vision',
    text: '人生で後悔していることはありますか？',
  },
  {
    id: 'vision-28',
    category: 'vision',
    text: '幸せを感じるのは、どんな時ですか？',
  },
  {
    id: 'vision-29',
    category: 'vision',
    text: '自分の人生観に影響を与えた人物や出来事は？',
  },
  {
    id: 'vision-30',
    category: 'vision',
    text: '今の自分に一番必要なものは何だと思いますか？',
  },
  {
    id: 'vision-31',
    category: 'vision',
    text: '人生で譲れない原則や信念は何ですか？',
  },
  {
    id: 'vision-32',
    category: 'vision',
    text: '自分を表現するなら、どんな言葉が当てはまる？',
  },
  {
    id: 'vision-33',
    category: 'vision',
    text: 'これからの人生で挑戦したいことは？',
  },
  {
    id: 'vision-34',
    category: 'vision',
    text: '自分の弱さとどう向き合っていますか？',
  },
  {
    id: 'vision-35',
    category: 'vision',
    text: '人に助けられた経験で、一番印象的なことは？',
  },
  {
    id: 'vision-36',
    category: 'vision',
    text: '自分が他人に与えている影響は、どんなものだと思う？',
  },
  {
    id: 'vision-37',
    category: 'vision',
    text: '人生で重視する優先順位は、家族・仕事・趣味・健康のどれ？',
  },
  {
    id: 'vision-38',
    category: 'vision',
    text: '最近、自分の考えが変わったことはありますか？',
  },
  {
    id: 'vision-39',
    category: 'vision',
    text: '自分にとって本当の成功とは、どういう状態？',
  },
  {
    id: 'vision-40',
    category: 'vision',
    text: '苦手な人間関係と、どう付き合っていますか？',
  },
  {
    id: 'vision-41',
    category: 'vision',
    text: '自分の人生で一番大きな転機は、いつですか？',
  },
  {
    id: 'vision-42',
    category: 'vision',
    text: '心が落ち着く場所・時間は、どこですか？',
  },
  {
    id: 'vision-43',
    category: 'vision',
    text: '人生で学んだ一番大事な教訓は何ですか？',
  },
  {
    id: 'vision-44',
    category: 'vision',
    text: '自分の人生で「良かった」と思う選択は何ですか？',
  },
  {
    id: 'vision-45',
    category: 'vision',
    text: '今後の人生で後悔しないために、今からすることは？',
  },
];

export function getTopicsByCategory(category: Topic['category']): Topic[] {
  return STAGE0_TOPICS.filter((t) => t.category === category);
}

export function getRandomTopics(count: number, excludeIds?: Set<string>): Topic[] {
  const filtered = excludeIds ? STAGE0_TOPICS.filter((t) => !excludeIds.has(t.id)) : STAGE0_TOPICS;
  const shuffled = [...filtered].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
