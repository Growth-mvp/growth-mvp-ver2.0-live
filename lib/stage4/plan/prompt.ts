import { PLAN_ENGINE_PRINCIPLES, renderPrinciples } from '@/lib/judgmentPrinciples';
import { protectedKpisOf } from './assemble';
import type { PlanContext } from './context';
import { addMonths, PROVISIONAL_MAX_MONTHS, PROVISIONAL_MIN_MONTHS } from './period';

/** 活動と成果を区別するための判断原則（プロンプトの先頭に置く） */
export const ACTIVITY_VS_OUTCOME_RULES = `## 活動と成果を混同しない（最重要）
- 活動を実施することは目的ではない。会議・研修・記録・提案件数・訪問件数などは、それ自体では成果ではない。
- 次の例のように、活動が成果につながるメカニズムを説明できない行動は書かない：
  - 会議を行うことは目的ではない → 会議で何の判断を変え、どの障害を取り除くかを書く
  - 記録すること自体は改善ではない → 記録した情報で、どの判断・作業がどう変わるかを書く
  - 提案件数を増やすだけでは受注は増えない → 提案の質（顧客の課題との一致、決裁者への到達）と受注率の関係を書く
  - 研修を実施するだけでは社員の成果は高まらない → 研修後に、どの業務のどの行動が変わるかを書く
- 各行動について、次の5点を分かるように書く（mechanism）：
  1. 何が成果を妨げているか（section1.obstacles のどれに対応するか）
  2. その原因を、どう検証するか（obstacles の verifyBy）
  3. どの行動によって、状況を変えるか（actions の title と stateChange）
  4. 何を測れば改善したと判断できるか（supportsKpiKeys で結びつく KPI）
  5. なぜその改善が、顧客価値や業績につながるか（whyItMatters）
  mechanism に入れるのは obstacleRefs・stateChange・whyItMatters の3項目だけ。verifyBy は mechanism に書かない（原因の検証方法は section1.obstacles の verifyBy に書く）。
- 根拠がない原因は、basis を HYPOTHESIS として示し、検証の行動（verifyBy）を必ず添える。
- 活動の指標（会議の開催回数、研修の受講数、記録件数など）を、成果のKPI（COMPANY_RESULT・CUSTOMER_OUTCOME）として書かない。使うなら LEADING（先行指標）として、成果への道筋を mechanism で示す。
- 成果の指標の例：「計測・記録に必要な作業時間の削減率」「試験導入先の負担軽減を確認できた医療機関数」。活動の語（記録・会議など）が含まれていても、状態の変化を測っていれば成果である。`;

/** 制約の取り込み、KPIと行動の時系列・因果、重複の防止、根拠のある提案 */
export const CONSTRAINT_AND_LINK_RULES = `## 重要な制約（規制・安全・資金）を落とさない
- 入力の脅威（S2-SWOT-T）・弱み（S2-SWOT-W）・すり合わせ論点（S3-RISK-*）に、規制・法令・安全・資金・投資回収の制約があれば、必ず1か所以上に反映する。反映先は、障害（section1.obstacles）、リスク（section5.risks）、確認事項（verificationItems）のいずれか。
- 規制や法令の適用有無は、AIが決めつけない。「適用の有無と必要な手続きを確認する」という事実確認として書く。根拠がなければ basis を HYPOTHESIS にし、検証の行動（verifyBy）を添える。
- 資金の制約（投資余力、回収期間）は、財務項目の前提（freeNote・sourceNote）か確認事項に書く。

## KPIと行動の時系列・因果
- 「合意」「決定」「承認」「採用」を測るKPIは、その前提になる行動（条件整理・提案・設計など）で支える。「実施」「導入」「完了」の行動は、その結果を測るKPI（成果）にのみ紐づける。
- 行動がKPIを支えるなら、KPIの期限はその行動の期限以降にする。行動より前の期限のKPIを書かない。
- 他部門のKPI（入力の「他部門の施策」・S3-OTHER-*）は、この計画の追加KPIに入れない。確定KPIを含め、他部門の指標を変更・追加しない。関連がある場合は、verificationItems に「○○部の指標と連携する」として書き、その根拠（S3-OTHER-*）を sourceRefs に入れる。
- 記録・算出・分類・会議・研修の実施や完了は、成果のKPIにしない。途中の確認に使うなら LEADING とし、どの成果（不良率、廃棄量など）を動かすかを mechanism に書く。
- 顧客に選ばれる理由（whyChosen）は、それを試す行動の変化（mechanism.stateChange）と対応させる。

## 重複を作らない
- 同じ内容を測るKPIは作らない。確定KPI、または他の追加KPIと、測るものと目標値が同じなら重複。
- 同じ内容の確認事項を2回書かない。特に、責任者の決定は section5.responsible の確認として1回だけ書き、verificationItems には別の内容（費用、期間、評価方法、データの定義など）を書く。

## 根拠がある場合の提案（根拠が無ければ書かない）
- 追加KPIの目標値：入力の数値や既存KPIから推定できる場合のみ、targetBasis を AI_PROVISIONAL にして仮の目標値を書く。根拠が無ければ target を null にする。
- 責任者：入力の担当候補（次の一覧）から、プロジェクトの担当・確定KPIの担当に当たる人を responsible.name に入れ、basis を PROPOSAL、note を「候補（仮）。実行前に確定が必要」にする。候補が無ければ null。`;

export const ACTION_AND_VALUE_CHAIN_RULES = `## 実施事項の書き方（具体性）
- title は、誰が何を対象に何をするかが分かる行動にする。「整理する」「検討する」「確認する」の語だけで終わらせない（例：「既存の改装事例3件の改装前後のテナント売上を比べ表にする」）。
- deliverable は、この行動で残る成果物を書く（文書・試作仕様書・見積書・評価結果表など）。成果物が無い行動は書かない。
- exitCondition は、次の工程へ進む判断条件を数値・状態で書く（例：「試作の評価で、基準の不良率を下回った件数が3件以上」）。判断条件が書けない行動は、行動を分けるか、確認事項にする。

## 収益化までの段階（valueStage）
- 有償用途開発の場合、収益化は次の順に進む：ORDER_INTENT（発注意思の確認）→ PAID_CONTRACT（有償契約）→ VALIDATION（試作・検証）→ MASS_PRODUCTION_DECISION（量産移行判断）→ MASS_ORDER（量産受注）。
- 各行動に、その行動が進める段階を1つ書く。行動の order の順で段階が前に戻らないようにする（例：有償契約の後に発注意思の確認を置かない）。
- 段階をつなぐ中間成果（例：発注意思の確認書、有償契約の締結、試作評価の結果）は、実施事項の deliverable または確認事項（verificationItems）として示す。
- valueStage が PAID_CONTRACT（有償契約）の行動は、exitCondition に、発注書・契約書・注文書など正式な有償契約の成立を確認できる根拠を書く。顧客の意思確認、条件の確認、合意の記録だけでは、有償契約に到達したとはしない。
- 中間成果を新しいKPIとして増やさない。STAGE3入力KPIは変えず、必要な中間成果は実施事項と確認事項で扱う。`;

const OUTPUT_SHAPE = `{
  "provisionalPeriod": null,
  "section1": {
    "customerProblem": { "text": "", "basis": "", "sourceRefs": [] },
    "problemCause": { "text": "", "basis": "", "sourceRefs": [] },
    "ourValue": { "text": "", "basis": "", "sourceRefs": [] },
    "whyChosen": { "text": "", "basis": "", "sourceRefs": [] },
    "customerOutcome": { "text": "", "basis": "", "sourceRefs": [] },
    "companyResult": { "text": "", "basis": "", "sourceRefs": [] },
    "goalState": { "text": "", "basis": "", "sourceRefs": [] },
    "obstacles": [
      { "text": "何が成果を妨げているか", "basis": "", "verifyBy": "その原因をどう検証するか", "sourceRefs": [] }
    ]
  },
  "section2": { "actions": [
    {
      "order": 1, "title": "", "ownerRole": "", "dueYm": "YYYY-MM", "dependsOn": [], "basis": "", "sourceRefs": [],
      "supportsKpiKeys": ["S1 または A1"],
      "mechanism": { "obstacleRefs": [1], "stateChange": "どの状態がどう変わるか", "whyItMatters": "なぜ顧客価値や業績につながるか" },
      "deliverable": "この行動で残す成果物（文書・試作仕様書・見積書など）",
      "exitCondition": "次の工程へ進む判断条件（数値・状態で書く）",
      "valueStage": "ORDER_INTENT | PAID_CONTRACT | VALIDATION | MASS_PRODUCTION_DECISION | MASS_ORDER | OTHER"
    }
  ] },
  "section3": {
    "kpis": [
      { "key": "A1", "kind": "CUSTOMER_OUTCOME | COMPANY_RESULT | LEADING", "label": "", "target": 0, "unit": "", "targetBasis": "AI_PROVISIONAL | null", "due": "YYYY-MM", "owner": null, "measurement": "", "supportsActionOrders": [] }
    ],
    "stage3Review": [ { "stage3KpiId": "", "concern": "", "sourceRefs": [] } ]
  },
  "section4": { "financeItems": [
    {
      "key": "F1", "label": "", "kind": "REVENUE_UP | COST_REDUCTION | COST_INCREASE | NOT_FINANCIAL",
      "method": "FUNNEL | QUANTITY_UNIT_PRICE | DIRECT_AMOUNT | FREE",
      "inputs": [
        { "role": "MEETINGS", "label": "商談数", "value": null, "unit": "件", "basis": "", "confirmState": "UNCONFIRMED", "sourceRefs": [] }
      ],
      "amountBasis": "TOTAL | MONTHLY | ANNUAL", "startYm": "YYYY-MM", "endYm": null,
      "sourceNote": "", "basedOnKpiKeys": ["S1 または A1"], "freeNote": null
    }
  ] },
  "section5": {
    "responsible": { "name": null, "basis": "", "note": null },
    "roles": [ { "unit": "", "role": "", "actionOrders": [] } ],
    "budget": null,
    "risks": [ { "risk": "", "countermeasure": "", "confirmBy": "YYYY-MM", "basis": "", "sourceRefs": [] } ],
    "preconditions": []
  },
  "verificationItems": [
    { "item": "確認すること", "priority": "BEFORE_START | DETAIL", "confirmBy": "YYYY-MM", "sourceRefs": [] }
  ]
}`;

const FINANCE_RULES = `## 財務入力（section4）
- inputs は配列。各入力は role・label・value・unit・basis・confirmState・sourceRefs を持つ。
- role は次のいずれか：MEETINGS, WIN_RATE, AVG_DEAL, QUANTITY, UNIT_PRICE, DIRECT_AMOUNT, YIELD_RATE, COST_RATE, CONVERSION_RATE, RETENTION_RATE, OTHER。
- 方式（method）と役割の対応：
  - FUNNEL：MEETINGS・WIN_RATE・AVG_DEAL（売上増加のみ）
  - QUANTITY_UNIT_PRICE：QUANTITY・UNIT_PRICE
  - DIRECT_AMOUNT：DIRECT_AMOUNT
- 上の方式に当てはまらない項目（歩留まり、原価率、回収期間、投資額など）は method を "FREE" にし、freeNote に算定の考え方と、金額を作れない理由（不足している入力）を書く。FREE の項目は金額を作らず、入力を保持する。
- 数量と単価で表せる効果（例：導入件数 × 有償化の割合 × 単価）は、方式 QUANTITY_UNIT_PRICE を選び、根拠のある仮定の値（単価・数量）は basis HYPOTHESIS で value に入れる。仮定は仮説であり、確定値ではない。
- 売上の前提（対象の顧客数・受注率・平均受注額）が入力に無い案件は、売上効果の項目（方式 FUNNEL）に、仮の算定条件（MEETINGS・WIN_RATE・AVG_DEAL。必要なら COST_RATE・追加費用の OTHER）を basis HYPOTHESIS で入れる。sourceNote に、STAGE3に前提が無いため仮に置いたと書く。
- 方式が FREE の項目も、算定式に必要なデータ（数量・単価・原価・受注率・利益率など）を inputs に label 付きで列挙する。値が不明なら value を null、basis と confirmState を UNCONFIRMED にする。freeNote には、算定式（例：利益 = 売上 − 原価）と、不足しているデータを分けて書く。
- 役割は、1つの項目の中で同じ役割を2回使わない（OTHER は除く）。DIRECT_AMOUNT は金額の入力を1つだけ使い、それ以外の金額（直接原価・試作費など）は OTHER にして label に具体名を書く。
- 役割の選び方：利益率・原価率は COST_RATE、受注率は CONVERSION_RATE（または WIN_RATE）、歩留まりは YIELD_RATE、それ以外（投資額、回収期間、固定費など）は OTHER とし、label と unit に具体名と単位を書く（例：label「案件別の直接原価」、unit「円/件」）。
- 限界利益・粗利は、売上増加でも費用増加でもない。投資回収・回収期間・回収見込みも、売上増加・費用増加ではない。これらの項目の kind は NOT_FINANCIAL にし、method は FREE にする。freeNote に、算定に必要な入力（売上・直接原価・投資額・回収期間など）と、確認が必要な点を書く。これらは財務効果として反映せず、確認事項として残す。
- kind が NOT_FINANCIAL の項目は、金額を作らない（value は null のままにする）。
- 算定に使う入力の value は、入力情報から確認できる場合だけ数値。推定しかできないものは basis を HYPOTHESIS にして数値を書いてよい。根拠が無い場合は value を null、basis を UNCONFIRMED、confirmState を UNCONFIRMED にする。
- 金額（円）そのものは書かない。エンジンが入力から計算する。
- confirmState は UNCONFIRMED（根拠なし）か AI_PROPOSED（AIの提案）だけを書く。USER_CONFIRMED は書かない（確認は利用者だけが行う）。
- 顧客の売上増加と、自社の売上増加を混同しない。顧客の売上の変化は CUSTOMER_OUTCOME の KPI で示し、財務項目の根拠にしない。`;

const START_ORDER_RULE = (ctx: PlanContext) =>
  `- 開始前の確認事項（verificationItems の priority が BEFORE_START）の confirmBy は、開始月 ${ctx.startYm} 以前にする。開始月より後に必要な確認は priority を DETAIL にする。
- 最初の行動（order 1）の期限は、開始月 ${ctx.startYm} 以降にする。`;

function periodSection(ctx: PlanContext): string {
  if (ctx.endYm !== null) {
    return `- 計画期間：${ctx.startYm} 〜 ${ctx.endYm}（根拠：入力情報の期限）
- すべての dueYm・due・confirmBy・startYm・endYm はこの範囲内。
- provisionalPeriod は必ず null（期間の根拠があるため、仮期間を書かない）。
${START_ORDER_RULE(ctx)}`;
  }
  const lo = addMonths(ctx.startYm, PROVISIONAL_MIN_MONTHS - 1);
  const hi = addMonths(ctx.startYm, PROVISIONAL_MAX_MONTHS - 1);
  return `- 入力情報に計画期間の根拠が無い。provisionalPeriod に { "endYm": "YYYY-MM", "reason": "理由" } を書く（endYm は ${lo} 〜 ${hi} の範囲）。
- 開始は ${ctx.startYm}。すべての dueYm・due・confirmBy・startYm・endYm は、開始から仮の終了までの範囲内。
${START_ORDER_RULE(ctx)}`;
}

export function buildExecutionPlanPrompt(ctx: PlanContext): string {
  const sourceLines = ctx.sources.map((s) => `- ${s.ref}｜${s.stage}・${s.role}・${s.label}：${s.text}`);
  const protectedLines = protectedKpisOf(ctx).map(
    (k) => `- ${k.key}（stage3KpiId: ${k.stage3KpiId}）：${k.label}／目標 ${k.target ?? '未設定'}${k.unit}／期限 ${k.due ?? '未設定'}／担当 ${k.owner ?? '未設定'}`
  );
  const ownerLine = ctx.ownerCandidates.length
    ? ctx.ownerCandidates.join('、')
    : '（候補なし。responsible.name と担当欄は必ず null）';

  return `あなたは経営の実行計画を作る補助役です。以下の【入力情報】にある内容だけを根拠にしてください。入力にない事実・数値・人名を書いてはいけません。

${ACTIVITY_VS_OUTCOME_RULES}

${CONSTRAINT_AND_LINK_RULES}

${ACTION_AND_VALUE_CHAIN_RULES}

## 判断原則
${renderPrinciples(PLAN_ENGINE_PRINCIPLES)}

- 既存の戦略を無批判に肯定せず、実行可能性に疑問があれば verificationItems に確認事項として書く。ただし計画全体を警告だらけにせず、具体的な行動を優先する。
- ユーザーへの質問は書かない。確認が必要なことは verificationItems にまとめる。

## 確認事項と行動の量（現場社員が読むことを前提とする）
- verificationItems の priority が BEFORE_START のものは、実行前に確認する重要事項で、最大3件。残りは DETAIL。
- 主要な行動（actions）は原則3〜5件。必要な場合のみ増やす（8件まで）。
- 障害（obstacles）は、成果を妨げる重要なものを漏らさず書く（8件まで）。件数を減らすために、規制・安全・資金の制約や重大な事業上の制約を省かない。
- 簡潔にするために、戦略との関係や重要な実行条件を省略しない。省くのは重複だけ。

## 入力情報（sourceRefs には、この表の ID だけを書く。例：S2-CORE。角括弧や説明は付けない）
${sourceLines.join('\n')}

## STAGE3入力KPI（S キー・プログラムが保持。出力しない）
正式な承認の記録がないKPIは「確定」とは扱わない。内容・目標値・期限・担当は変えられない。
${protectedLines.length ? protectedLines.join('\n') : '（なし）'}
- STAGE3入力KPIは出力に含めない。行動や財務の根拠として参照するときは S キーを使う（supportsKpiKeys・basedOnKpiKeys）。
- STAGE3入力KPIの内容・目標値・期限・担当は変えられない。戦略との矛盾に気づいた場合は、section3.stage3Review に stage3KpiId と concern を書く（変更はしない）。
- 追加KPI（kpis）は A1, A2 … のキーで書く。AI提案・未確認として書き、「確定」「確認済み」とは書かない（targetBasis は AI_PROVISIONAL か null）。STAGE3入力KPIと同じ内容や名前にしない。他部門のKPIと同じものも作らない。
- 追加KPIの目標値は targetBasis を "AI_PROVISIONAL" にする（確認済みとして扱わない）。
- 必要な先行KPI（LEADING）のみ追加する。活動の回数を成果KPIの代わりにしない。

## 計画の期間
${periodSection(ctx)}
- 行動は order を 1 から連番にし、dependsOn には先行する order のみを書く。先行行動の期限は後続以前にする。
- KPIの期限は、その KPI を支える行動の期限より後にする（行動より前の期限は書かない）。

## 担当者・予算
- 担当者名は次の候補からのみ選ぶ、または null：${ownerLine}
- 候補にない人名を書かない。候補を選んだ場合は basis を PROPOSAL にし、note に「候補（仮）。実行前に確定が必要」と書く。確認できない担当は name を null、basis を UNCONFIRMED にし、note に確認の内容を書く。
- budget は必ず null（予算は入力にない）。

## 顧客成果と自社の業績
- 顧客の成果（customerOutcome・CUSTOMER_OUTCOME の KPI）と自社の業績（companyResult・COMPANY_RESULT の KPI）を分けて書く。
- CUSTOMER_OUTCOME の KPI は、財務項目の basedOnKpiKeys に含めない。

${FINANCE_RULES}

## basis（根拠区分）
- STAGE_DATA：入力情報の内容をそのまま使った（sourceRefs 必須）
- DERIVED：入力情報の数値から計算した（sourceRefs 必須）
- HYPOTHESIS：AIの仮説（確認が必要）
- PROPOSAL：AIの提案（行動や目標の案）
- UNCONFIRMED：根拠が無く、値は null

## 出力
JSON だけを出力する。説明やコメントは書かない。次の形に従う（値は例示）。形にないキーは、どの階層にも追加しない。
${OUTPUT_SHAPE}`;
}
