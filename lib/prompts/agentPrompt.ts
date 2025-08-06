import { ChatCompletionMessageParam } from "openai/resources";

export const agentPrompt = (
  step: number,
  userInput: string
): ChatCompletionMessageParam[] => {
  const baseContext = `
あなたは「経営者AIエージェント」です。
ユーザーの思考を引き出し、問いを通じて戦略を共に構築する役割です。
ユーザーはGROWTHというツールを初めて使う前提で、
親切でわかりやすい対話を通して、考える流れに自然に導いてください。
回答は一方的に教えるのではなく、問い返す形で展開してください。
`;

  const steps: string[] = [
    'はじめまして。私は経営者AIエージェントです。\nあなたの考えを言葉にし、未来を一緒に描くお手伝いをします。\nまず、あなたの会社や組織の「理想の姿」について、簡単に教えていただけますか？',
    'ありがとうございます。\nでは今、その理想に向かううえで、どんな「気がかり」や「壁」を感じていますか？\n業績、組織、人材、外部環境など、何でも構いません。',
    'その課題は、主に「外部環境（市場・競合など）」によるものでしょうか？\nそれとも「内部要因（人・体制・意識など）」によるものだと思いますか？',
    '3年後、あなたの会社が「こうなっていたら最高」と思える状態を、一言で表すと何ですか？',
    'その未来に近づくために、今すぐ始められそうな第一歩は何でしょう？\n小さなことでも構いません。',
    'ありがとうございます。ここまでの対話は、あなたの「戦略の原石」として保存できます。\nあとから振り返って深めたり、社員と共有したりできます。保存してもよろしいですか？',
    'では、保存しました。ここからさらに、「事業の柱」や「部門ごとの役割」へと具体化していきましょうか？\nご希望であれば、AIが一緒にカスケード構造の設計をサポートします。',
    'たとえば、営業・開発・人事などの部門ごとに、「何を目指し、どう動くか」を一緒に考えることもできます。\nどの部門から進めてみましょうか？',
    'ありがとうございます。これ以降はご希望に合わせて、AIが伴走支援します。\n気になることがあれば、いつでもご相談ください。',
  ];

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: baseContext.trim() },
  ];

  if (step === 0 && !userInput) {
    messages.push({ role: "assistant", content: steps[0] });
  } else {
    if (userInput) {
      messages.push({ role: "user", content: userInput });
    }
    messages.push({
      role: "assistant",
      content: steps[step] ?? "ここまでの対話をもとに、次のアクションを一緒に考えていきましょう。",
    });
  }

  return messages;
};
