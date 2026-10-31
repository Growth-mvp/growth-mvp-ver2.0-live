// utils/industryTemplates.ts

// === 表示用の業種オプション（一般セクターのみ） ====================
// labelShort … 一覧やサマリーに出す短い日本語表記（ここでは label と同一）
// 業種コードは保存値として固定（変更・削除しない）。表示名のみ分類名に合わせる。
// 選択肢に出すのは SELECTABLE_INDUSTRY_VALUES の16分類。それ以外は保存済みデータの表示用。
export const industryOptions = [
  { value: 'manufacturing',             labelShort: '製造業',                 label: '製造業' },
  { value: 'construction',              labelShort: '建設業',                 label: '建設業' },
  { value: 'wholesale',                 labelShort: '卸売業',                 label: '卸売業' },
  { value: 'retail',                    labelShort: '小売業',                 label: '小売業' },
  { value: 'it',                        labelShort: '情報通信・IT',           label: '情報通信・IT' },
  { value: 'logistics',                 labelShort: '運輸・物流業',           label: '運輸・物流業' },
  { value: 'finance',                   labelShort: '金融・保険業',           label: '金融・保険業' },
  { value: 'real_estate',               labelShort: '不動産業',               label: '不動産業' },
  { value: 'healthcare',                labelShort: '医療・福祉',             label: '医療・福祉' },
  { value: 'education',                 labelShort: '教育・学習支援',         label: '教育・学習支援' },
  { value: 'hospitality',               labelShort: '宿泊・飲食業',           label: '宿泊・飲食業' },
  { value: 'professional_services',     labelShort: '専門サービス業',         label: '専門サービス業' },
  { value: 'service',                   labelShort: 'その他サービス業',       label: 'その他サービス業' },
  { value: 'agri_forestry_fishery',     labelShort: '農林水産業',             label: '農林水産業' },
  { value: 'energy_resources',          labelShort: 'エネルギー・インフラ',   label: 'エネルギー・インフラ' },
  { value: 'other',                     labelShort: 'その他',                 label: 'その他' },
  { value: 'food_beverage',             labelShort: '食品・飲料',             label: '食品・飲料' },
  { value: 'it_software',               labelShort: 'IT（ソフトウェア）',     label: 'IT（ソフトウェア）' },
  { value: 'it_services',               labelShort: 'IT（SI/受託・運用）',     label: 'IT（SI/受託・運用）' },
  { value: 'telecom',                   labelShort: '通信',                   label: '通信' },
  { value: 'media_entertainment',       labelShort: 'メディア・エンタメ',     label: 'メディア・エンタメ' },
  { value: 'advertising_marketing',     labelShort: '広告・マーケティング',   label: '広告・マーケティング' },
  { value: 'finance_banking',           labelShort: '金融（銀行・証券）',     label: '金融（銀行・証券）' },
  { value: 'insurance',                 labelShort: '保険',                   label: '保険' },
  { value: 'pharma_biotech',            labelShort: '製薬・バイオ',           label: '製薬・バイオ' },
  { value: 'utilities_env',             labelShort: '公共・インフラ・環境',   label: '公共・インフラ・環境' },
  { value: 'chemicals_materials',       labelShort: '化学・素材',             label: '化学・素材' },
  { value: 'automotive',                labelShort: '自動車（完成車・部品）', label: '自動車（完成車・部品）' },
  { value: 'electronics_semiconductor', labelShort: '電機・半導体',           label: '電機・半導体' },
  { value: 'machinery',                 labelShort: '機械・産業機器',         label: '機械・産業機器' },
  { value: 'apparel_consumer',          labelShort: 'アパレル・生活消費財',   label: 'アパレル・生活消費財' },
  { value: 'public_sector_nonprofit',   labelShort: '公共・団体（NPO含む）',  label: '公共・団体（NPO含む）' },
] as const;

export type IndustryValue = (typeof industryOptions)[number]['value'];
export type IndustryOption = (typeof industryOptions)[number];

export const SELECTABLE_INDUSTRY_VALUES: readonly IndustryValue[] = [
  'manufacturing',
  'construction',
  'wholesale',
  'retail',
  'it',
  'logistics',
  'finance',
  'real_estate',
  'healthcare',
  'education',
  'hospitality',
  'professional_services',
  'service',
  'agri_forestry_fishery',
  'energy_resources',
  'other',
];

export const selectableIndustryOptions: IndustryOption[] = SELECTABLE_INDUSTRY_VALUES.flatMap((v) => {
  const opt = industryOptions.find((o) => o.value === v);
  return opt ? [opt] : [];
});

// 英語コード → 日本語ラベルに変換（デフォルトは短い表記）
export function getIndustryLabel(value: string, opts?: { full?: boolean }) {
  const opt = industryOptions.find((i) => i.value === (value as IndustryValue));
  if (!opt) return value; // マッピングに無ければ原文のまま
  return opts?.full ? opt.label : opt.labelShort;
}

// === 各セクターのテンプレ（簡潔版） ================================
// 既存の利用箇所を壊さないため、全セクターに最低限のテンプレを用意。
// 必要に応じて今後リッチ化（業界ごとの “成功/失敗/トレンド/指標” など）可能です。
export const industryTemplates: Record<string, string> = {
  manufacturing: `
製造業では、品質・コスト・納期（QCD）の同時最適化と、差別化の源泉（加工技術・設計力・ブランド）の確立が鍵です。
成功パターン：高付加価値化／工程DX／ニッチトップ。注意点：価格競争の泥沼化・属人化・投資遅延。
`,
  construction: `
建設・設備工事では、原価管理と工程管理、技能継承、元請比率の設計が収益を左右します。
成功パターン：設計〜保守の一貫受注／BIM・現場DX／協力会社との連携深化。
`,
  logistics: `
物流・運輸では、配送効率・労務管理・再配達率の最適化が重要です。
成功パターン：動的配車／可視化とKPI運用／マルチチャネル連携。`,
  retail: `
小売（店舗・EC）では、在庫/粗利/回転の管理と、リアル×デジタルの統合体験が差別化要因です。
成功パターン：SKU最適化／リピート設計／オムニチャネル。`,
  it: `
情報通信・ITでは、受託開発・SaaS・運用保守・通信インフラなど提供形態によって成長の型が分かれます。
成功パターン：継続課金（ストック収益）化／顧客の業務データを活かした付加価値提供／人材確保と稼働率の管理。`,
  finance: `
金融・保険業では、規制対応・信用リスク管理・顧客接点のデジタル化が収益と信頼の前提になります。
成功パターン：顧客の資産形成・保障ニーズに沿った商品設計／チャネルの見直しと代理店網の再設計／審査とコンプライアンスの効率化。`,
  service: `
その他サービス業では、提供価値（時間・品質・体験）と、顧客が繰り返し利用する仕組みが成長の鍵です。
成功パターン：継続契約型の料金設計／専門人材の育成と稼働の平準化／顧客接点のデジタル化による継続利用の促進。`,
  wholesale: `
卸売では、独自調達・情報力・与信管理が競争力に直結します。
成功パターン：メーカー共創／付加価値提案／受発注DX。`,
  food_beverage: `
食品・飲料では、品質保証・収率改善・ブランド構築が核です。
成功パターン：製造工程の可視化／新商品の継続的投入／チャネル最適化。`,
  hospitality: `
宿泊・外食・観光では、稼働率×単価×原価の設計と、体験価値の磨き込みが重要です。
成功パターン：収益管理（RM）／レビュー運用／人材定着。`,
  it_software: `
IT（ソフトウェア）では、開発速度と顧客提供価値の継続改善が成長ドライバーです。
成功パターン：SaaS/PLG／データに基づく継続率改善／明確なICP。`,
  it_services: `
IT（SI/受託・運用）では、標準化・再利用・契約設計（定額/成果）で粗利を安定化。
成功パターン：PMO/テンプレ化／運用自動化／上流比率向上。`,
  telecom: `
通信では、ネットワーク品質・料金設計・付加価値サービスの組合せが鍵です。
成功パターン：束ね売り／地域パートナー戦略／運用の自動化。`,
  media_entertainment: `
メディア・エンタメでは、IP/コンテンツ価値と配信モデルの最適化が収益源です。
成功パターン：マルチプラットフォーム展開／ファンダム運用／広告×サブスクの複線化。`,
  advertising_marketing: `
広告・マーケでは、クリエイティブ×データ運用×成果連動が差に。
成功パターン：運用型最適化／アトリビューション設計／顧客の売上直結提案。`,
  professional_services: `
専門サービスでは、知見資産化と再現性あるデリバリーモデルが拡張の鍵。
成功パターン：ナレッジ化／スコープ標準化／継続課金化。`,
  finance_banking: `
金融（銀行・証券）では、リスク管理と顧客LTVの最大化が中心課題。
成功パターン：デジタル接点強化／与信モデル高度化／クロスセル。`,
  insurance: `
保険では、引受精度・商品設計・チャネル戦略が成否を分けます。
成功パターン：データ活用／保全・見直しプロセス最適化／CX向上。`,
  real_estate: `
不動産では、開発・仲介・PMの組合せと在庫/利回り設計が収益源。
成功パターン：データ査定／稼働率改善／アセットマネジメント。`,
  healthcare: `
ヘルスケア（病院・クリニック）では、人材確保・稼働最適化・地域連携が重要。
成功パターン：ICT化／診療報酬最適化／患者体験の改善。`,
  pharma_biotech: `
製薬・バイオでは、研究開発の成功確率とアロケーションが価値を決めます。
成功パターン：PoCマイルストン管理／共同開発／品質・薬事の早期織り込み。`,
  education: `
教育・研修では、学習効果の可視化と継続契約の設計が成長ドライバー。
成功パターン：オンライン併用／法人パッケージ／評価指標の運用。`,
  energy_resources: `
エネルギー・資源では、価格変動リスクと設備稼働率/安定供給の両立が重要。
成功パターン：長期契約設計／再エネミックス／需給最適化。`,
  utilities_env: `
公共・インフラ・環境では、安定供給と効率化、規制対応が中心課題。
成功パターン：設備更新計画／スマート化／官民連携。`,
  agri_forestry_fishery: `
農林水産では、生産性・品質・販路の三位一体で付加価値を高めます。
成功パターン：スマート化／6次産業化／ブランド化。`,
  chemicals_materials: `
化学・素材では、配合/プロセス知見と用途開発が差別化の核。
成功パターン：高機能材シフト／共同開発／環境対応。`,
  automotive: `
自動車（完成車・部品）では、電動化/ソフトウェア化/サプライチェーン再編が進展。
成功パターン：モジュール化／品質トレーサビリティ／グローバル最適。`,
  electronics_semiconductor: `
電機・半導体では、技術ロードマップと設備投資の意思決定が価値を左右。
成功パターン：高付加価値領域集中／歩留まり改善／アライアンス。`,
  machinery: `
機械・産業機器では、アフターサービス/リカーリング化で収益の安定化を図ります。
成功パターン：装置IoT／保全契約／グローバル販社連携。`,
  apparel_consumer: `
アパレル・生活消費財では、需要予測と在庫最適化、ブランド体験が核心。
成功パターン：ファスト×定番のポートフォリオ／D2C／リピート強化。`,
  public_sector_nonprofit: `
公共・団体では、限られたリソースの中での成果最大化と説明責任が重要。
成功パターン：データ駆動の政策・事業運営／連携基盤の整備。`,
  other: `
「その他」の場合は、ビジネス特性に近いセクターのテンプレを参考にカスタマイズしてください。
`,
};

// サブセクターは運用しない前提なので、単純なフォールバック関数でOK
export function getIndustryTemplate(industry?: string): string | undefined {
  if (!industry) return undefined;
  return industryTemplates[industry];
}
