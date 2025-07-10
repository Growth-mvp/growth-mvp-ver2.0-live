// lib/openaiClient.ts
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateCascadeFromStrategy(strategy: string) {
  const prompt = `
あなたは経営戦略をもとに、部門戦略・プロジェクト・OKRを階層構造で設計する専門家です。

次の経営戦略をもとに、以下のJSON形式で構造を生成してください：

{
  id: "root",
  type: "経営戦略",
  title: "○○",
  description: "○○",
  children: [
    {
      id: "dep-1",
      type: "部門戦略",
      title: "○○",
      children: [
        {
          id: "pj-1",
          type: "プロジェクト",
          title: "○○",
          children: [
            {
              id: "okr-1",
              type: "OKR",
              title: "○○"
            }
          ]
        }
      ]
    }
  ]
}

経営戦略：
${strategy}
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  const text = completion.choices[0].message.content || '{}';
  return JSON.parse(text);
}
