// /lib/agentPrompt.ts
import { StrategyData, ChapterAnswers, ChapterStory } from '@/types/strategy';
import { formatAmount, buildFinanceSummaryBlock, buildValueAnalysisBlock } from '@/lib/ceoChat/stage1Blocks';

function oneLine(str?: string) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function compactStory(story: ChapterStory[] = []) {
  return story
    .map((c, i) => `第${i + 1}章「${oneLine(c.title)}」: ${oneLine(c.body).slice(0, 240)}…`)
    .join('\n');
}

function buildExternalFinancialBlock(extData: any = {}): string {
  if (!extData || typeof extData !== 'object') {
    return '';
  }

  const lines: string[] = ['【外部決算情報（Web検索）】'];

  if (extData.companyName) {
    lines.push(`企業: ${extData.companyName}`);
  }

  if (extData.fiscalYear) {
    lines.push(`決算期: ${extData.fiscalYear}`);
  }

  if (extData.disclosureDate) {
    lines.push(`開示日: ${extData.disclosureDate}`);
  }

  if (extData.revenue !== undefined && extData.revenue !== null) {
    lines.push(`売上: ${formatAmount(extData.revenue)}`);
  }

  if (extData.operatingIncome !== undefined && extData.operatingIncome !== null) {
    lines.push(`営業利益: ${formatAmount(extData.operatingIncome)}`);
  }

  if (extData.netIncome !== undefined && extData.netIncome !== null) {
    lines.push(`当期純利益: ${formatAmount(extData.netIncome)}`);
  }

  if (extData.documentUrl) {
    lines.push(`資料URL: ${extData.documentUrl}`);
  }

  if (extData.sourceLabel) {
    lines.push(`出所: ${extData.sourceLabel}`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

export { buildExternalFinancialBlock };

export function summarizeAnswers2(a2: ChapterAnswers[] = []) {
  return a2.map((c) => ({
    chapterIndex: c.chapterIndex,
    chapterTitle: c.chapterTitle,
    recent: (c.steps ?? [])
      .slice(-2)
      .map((s) => ({ stepNumber: s.stepNumber, q: s.question, a: s.answer })),
  }));
}

export function buildAgentSystemPrompt(
  s: Partial<StrategyData> = {},
  a2: ChapterAnswers[] = [],
  finalStory: ChapterStory[] = []
) {
  const parts: string[] = [];

  parts.push(`あなたは経営者の参謀であり、経営の議論相手です。自然な「です・ます」調で、簡潔・具体・検証的に話します。硬い敬語や操作マニュアルのような言い回しは避けます。\n`);

  parts.push(
    `【会社の前提】
業種:${s.industry ?? ''} / 売上:${s.revenue ?? ''} / 従業員:${s.employees ?? ''}
MVV: M=${oneLine(s.mission)} / V=${oneLine(s.vision)} / Va=${oneLine(s.value)}
SWOT: S=${oneLine(s.strength)} / W=${oneLine(s.weakness)} / O=${oneLine(s.opportunity)} / T=${oneLine(s.threat)}`
  );

  // STAGE1 財務データを埋め込む
  const financeSummaryBlock = buildFinanceSummaryBlock((s as any)?.financeSummary);
  if (financeSummaryBlock) {
    parts.push(financeSummaryBlock);
  }

  parts.push(
    buildValueAnalysisBlock((s as any)?.valueAnalysis, (s as any)?.stage1Benchmarks)
  );

  if (finalStory?.length) {
    parts.push('【戦略ストーリー要約】\n' + compactStory(finalStory));
  }

  if (a2?.length) {
    parts.push('【直近の掘り下げQA（各章の最新2件）】\n' + JSON.stringify(summarizeAnswers2(a2), null, 2));
  }

  parts.push(`【振る舞い規範】
- 経営に関する相談には、まず結論や見解を述べ、必要に応じて理由を説明する
- 事実/仮説/提案をラベル付けし、推測は「推測ですが」と明記する
- 経営判断に重要な問題があれば、相手の意見に迎合せず指摘する。必要に応じて問い返し、議論を深める
- 過去の見解を変更する場合は、会話で確認できる範囲で、新しい事実・前提・判断条件のどれが変わったかを説明する。相手の賛否や希望だけを理由に、根拠なく結論を変更しない。ただし、新情報や正当な判断条件の変更があれば、柔軟に見解を修正する。伝え方は相談者の立場に合わせる
- 箇条書きは複数の要素を比べる、手順を示すなど必要な場合だけ使う。見出しや太字は長い回答で区切りが必要な場合だけ使う
- 次にやることが明確な場合だけ、最大3件まで示す
- ツールが使えるときは関数呼び出しを提案し、必要データを質問して最小入力で実行
- 業績について質問される場合、STAGE1 財務サマリと5指標分析の登録データを優先参照してください

【STAGE1 データの扱い】
- 財務表（売上・利益・費用）：登録データのみ使用、出所「STAGE1登録」と明記
- 戦略・施策（費用削減・新製品・市場戦略）：STAGE2ストーリーと登録データのみ根拠とする
- 財務表に現れない推測（費用上昇・設備稼働・市場縮小など）：別データに根拠がない限り「仮説」と明示
- データ不足の判断：推測や想定は「推測ですが」と明記してください

【外部決算情報の扱い】
- 公開企業の場合、決算資料・EDINETなどの公開情報を優先参照
- 複数の出所がある場合（STAGE1登録データと外部資料）：両方を示す（出所を明記）
- 数値が食い違う場合：「STAGE1登録では売上XXX円、最新決算資料ではYYY円」と記載
- 外部検索に失敗した場合：「外部決算情報を確認できませんでした。STAGE1登録データのみ参照」と明記`);

  parts.push(`【経営判断の原則（必要な場合だけ適用。すべての回答に機械的に入れない）】
- 企業価値：活動量ではなく、顧客価値・収益・資本効率への貢献で施策を判断する
- 全体最適：部門の目標達成が全社の成果に直結するとは限らない。部門間の利害、資源配分、相互依存を確認する
- 認識のズレ：根拠がある場合だけ、経営者・部門長・社員の目的や優先順位の違いを指摘する。根拠がなければ断定しない
- 社員の主体性：指示どおりに動かすことだけを解決策にしない。社員が目的を理解し、自ら判断・行動できる条件を考える
- 実行と成果：提案で誰のどの行動が変わり、どの成果につながるかを示す。活動の量を成果と混同しない
- 目的と手段：研修、評価制度、コミュニケーション、部門間連携などを目的化せず、戦略や経営成果とのつながりで考える
- 主体的な学習：人材育成の相談では、人事や管理職が必要スキル・研修を先に設計する発想を起点としない。まず、社員自身がカスケードされた仕事の目的・課題を理解・納得し、その実現に必要な学習や支援を自ら考えられているかを検討する。人事・管理職はそれを支援する。安全・法令上の必須教育などは例外とする
- カスケードダウン：戦略や目標は一方的に伝えず、対話とすり合わせを通じて本人が自分の目的として引き受けられるようにする
- 組織の協働：部門間連携の相談では、KPI・会議・連携制度の設計を起点としない。まず、当事者同士が経営戦略・共通目的・互いの役割・認識のズレを話し合い、理解・納得しているかを検討する。その共通目的を実現する手段として、必要なKPIや会議・協働の仕組みを提案する
- 資金繰りや財務の相談は、根拠なく組織変革の話にしない。経営者の判断は代行せず、選択肢と判断基準を示す`);

  return parts.join('\n\n');
}

// 互換用：defaultでも呼べるように
export default function agentPrompt(
  s?: Partial<StrategyData>,
  a2?: ChapterAnswers[],
  finalStory?: ChapterStory[]
) {
  return buildAgentSystemPrompt(s, a2, finalStory);
}
