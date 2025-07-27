import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { story } = await req.json();
    console.log('📥 受信ストーリー全文:', story);

    if (!story || story.length < 10) {
      console.warn('⚠️ ストーリーが短すぎます');
      return new NextResponse(
        JSON.stringify({ error: 'ストーリーが不正です' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sectionTitles = [
      '■現状の危機や背景（なぜ今、変革しなければならないのか）',
      '■経営者が描く未来の方向性（どこを目指すのか）',
      '■SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）',
      '■社員に求める行動や期待（自分ごととして捉えてもらう）',
    ];

    const matches = story.match(/■[^\n]+\n[\s\S]*?(?=(■[^\n]+\n)|$)/g) || [];
    const splitSections = matches.map((section: string) =>
      section.replace(/^■[^\n]+\n?/, '').trim()
    );

    if (splitSections.length !== sectionTitles.length) {
      return new NextResponse(
        JSON.stringify({
          error: `章数の解析に失敗しました。期待: ${sectionTitles.length}, 実際: ${splitSections.length}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const chapters = sectionTitles.map((title, index) => ({
      title: title.replace(/^■/, '').trim(),
      body: splitSections[index].trim(),
    }));

    const promptsByChapter: Record<string, string> = {
      '現状の危機や背景（なぜ今、変革しなければならないのか）':
        'この章では社員に「なぜ今、変革が必要なのか？」を深く問い直させ、危機感と変革の必然性を腹落ちさせる問いを設計してください。',
      '経営者が描く未来の方向性（どこを目指すのか）':
        'この章では社員が未来のビジョンを自分ごととして捉え、どんな価値を社会に生み出そうとしているのかを内省できる問いを設計してください。',
      'SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）':
        'この章では社員が戦略的な意思決定の背景や、なぜその選択肢が重要なのかを深く理解できる問いを設計してください。',
      '社員に求める行動や期待（自分ごととして捉えてもらう）':
        'この章では社員が自分の行動変容や役割に真剣に向き合い、自律的な一歩を考えるような問いを設計してください。',
    };

    const chapterAnswers = [];

    for (const chapter of chapters) {
      const extraPrompt = promptsByChapter[chapter.title] || '';

      const prompt = `
あなたはドラッカーのような経営思想家です。
以下のストーリー章（${chapter.title}）を読んで、その章に関して社員の理解と自律を深めるための「深い問い」を2～3問設計してください。

${extraPrompt}

各問いには「なぜこの問いが重要か」という理由も添えてください。
表面的な確認ではなく、戦略・組織・価値創造・人間理解などに関わる本質的な問いにしてください。

【章の内容】
${chapter.body}

【出力形式】
[
  {
    "question": "～～～？",
    "reason": "～～～だからこの問いが重要"
  }
]
`.trim();

      console.log(`🧠 ${chapter.title} に対するプロンプト送信開始`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'あなたは社員の問いを設計するプロフェッショナルです。出力は必ず厳密なJSON配列形式（[ { question, reason }, ... ]）で返してください。補足・説明・前後の文は禁止です。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
      });

      const raw = response.choices?.[0]?.message?.content ?? '[]';
      console.log(`📄 ${chapter.title}のAI出力:`, raw);

      let parsed: { question: string; reason: string }[] = [];

      try {
        const jsonStart = raw.indexOf('[');
        const jsonEnd = raw.lastIndexOf(']');
        if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error('JSONの開始/終了位置が見つかりません');
        }

        const jsonText = raw.slice(jsonStart, jsonEnd + 1);
        parsed = JSON.parse(jsonText);
      } catch (err) {
        console.warn(`❗️JSONパース失敗（${chapter.title}）:`, raw);
        return new NextResponse(
          JSON.stringify({ error: `${chapter.title}のAI出力形式が不正です` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const steps = parsed.map((item) => ({
        question: item.question,
        reason: item.reason,
        answer: '',
      }));

      chapterAnswers.push({
        chapterTitle: chapter.title,
        steps,
      });
    }

    console.log('✅ 章ごとの質問生成完了');

    return new NextResponse(
      JSON.stringify({ answers2: chapterAnswers }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ 質問生成エラー:', error);
    return new NextResponse(
      JSON.stringify({ error: '質問生成に失敗しました' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
