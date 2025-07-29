import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
})

export async function generateStoryFromGuide(answers: string[]) {
  const prompt = `
あなたは優秀な経営戦略コンサルタントです。
以下は経営層の回答です。これをもとに、会社の現状→課題→方向性→社員への期待が明確な「戦略ストーリー」を1ページで作成してください。

Q1. 最大の危機：${answers[0]}
Q2. 原因：${answers[1]}
Q3. 目指す方向性：${answers[2]}
Q4. 社員への期待：${answers[3]}

ビジネスの現実感と人に伝わる言葉でお願いします。
`

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  })

  return res.choices[0].message.content || ''
}
