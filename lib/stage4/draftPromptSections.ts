import type { ExecutionCompanyContext } from './companyContext';

export const ASSUMPTION_BASIS = ['USER_DATA', 'DERIVED', 'HYPOTHESIS', 'PRESET', 'MISSING'] as const;
export type AssumptionBasis = (typeof ASSUMPTION_BASIS)[number];

export const ASSUMPTION_BASIS_LABEL: Record<AssumptionBasis, string> = {
  USER_DATA: '登録済みの会社実績・利用者入力',
  DERIVED: '既存情報から計算した値',
  HYPOTHESIS: 'AIの仮説（確認が必要）',
  PRESET: '固定プリセット',
  MISSING: '根拠が不足（未算定）',
};

export const CAUSAL_KEYS = ['customer', 'problem', 'whyUs', 'actions', 'outcome', 'moneyPath', 'verifyNumbers'] as const;
export type CausalChain = Partial<Record<(typeof CAUSAL_KEYS)[number], string>>;

export const CAUSAL_LABEL: Record<(typeof CAUSAL_KEYS)[number], string> = {
  customer: 'どの顧客のどの課題を解決するか',
  problem: '課題が起きている理由',
  whyUs: 'なぜ自社が選ばれると考えるか',
  actions: 'そのために実行すること',
  outcome: '生まれる成果',
  moneyPath: '成果が売上・利益にどうつながるか',
  verifyNumbers: '実現可能性を確かめるために確認すべき数値',
};

/** AIに渡す会社情報の節。記録済みの情報だけを載せ、無い項目は書かない */
export function companyContextSection(ctx?: ExecutionCompanyContext): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.department) {
    const d = ctx.department;
    lines.push(`- 部門：${d.name || '—'}`);
    if (d.strategicRole) lines.push(`- 部門の役割：${d.strategicRole}`);
    if (d.keyIssues.length) lines.push(`- 部門の重点課題：${d.keyIssues.join('／')}`);
    if (d.interDeptCollab.length) lines.push(`- 部門間の連携事項：${d.interDeptCollab.join('／')}`);
    if (d.alignmentRisks.length) lines.push(`- すり合わせの論点：${d.alignmentRisks.join('／')}`);
  }
  if (ctx.priorityThemes.length) lines.push(`- 全社の重点テーマ：${ctx.priorityThemes.join('／')}`);
  if (ctx.strategyExcerpt) lines.push(`- 全社戦略（抜粋）：\n${ctx.strategyExcerpt}`);
  if (ctx.latestFinance) {
    const f = ctx.latestFinance;
    const rev = f.revenueMJPY === null ? '未入力' : `${f.revenueMJPY}百万円`;
    const op = f.operatingIncomeMJPY === null ? '未入力' : `${f.operatingIncomeMJPY}百万円`;
    const m = f.operatingMarginPct === null ? '' : `（営業利益率 ${f.operatingMarginPct}%）`;
    lines.push(`- 直近の財務実績（${f.year}年度）：売上 ${rev}、営業利益 ${op}${m}`);
  }
  if (lines.length === 0) return '';
  return `【会社の現状（登録済みの情報のみ。ここに無い数値を実績として書かないこと）】\n${lines.join('\n')}`;
}

/** 因果関係・算定方式・数値の根拠区分に関する指示 */
export const REASONING_RULES = `## 実行計画の因果関係（必ず順に考える）
次の順番で、実行計画が「どの顧客の課題を、なぜ自社が解決し、どの成果が売上・利益につながるか」を説明できるようにしてください。
1. どの顧客のどの課題を解決するのか
2. なぜ自社が選ばれると考えるのか（会社の強み・重点テーマと矛盾しないこと）
3. そのために何を実行するのか（一般的な活動名ではなく、誰に何をするかを書く）
4. どのような成果が生まれるのか
5. その成果は売上・利益にどうつながるのか
6. 実現可能性を判断するため、何の数値を確認すべきか

STAGE2の勝ち筋・重点テーマ、STAGE3の部門の役割と重点課題に反する施策は作らないこと。

## 算定方式（事業に合う方式だけを使う）
- 新規顧客獲得：営業対象数 × 受注率 × 単価（FUNNEL）
- 既存顧客の売上拡大：既存顧客数 × 購入頻度 × 追加購入額（当てはまる場合だけ）
- 会員・継続課金：既存会員数、新規加入数、退会率・継続率、月額単価（FUNNELに無理に変換しない）
- 値上げ：対象売上 × 価格改定率（販売数量への影響を確認項目にする）
- 生産性向上：作業量 × 時間短縮 ＝ 実際に削減できる費用（COST）
- 新規事業・新用途開拓：顧客候補、利用意向、採算条件を確認項目にし、数値は未確定のまま出す
当てはまる方式が無い場合は、assumptions を null にし、必要な前提を verificationItems に書いてください。

## 数値の根拠区分（assumptionBasis）
各前提（assumptions のキー）に、次のいずれかを割り当ててください。
- USER_DATA：【会社の現状】に記録がある実績・利用者入力
- DERIVED：記録済みの数値から計算できる値
- HYPOTHESIS：AIが置いた仮説（必ず確認が必要）
- PRESET：固定の目安
- MISSING：根拠が無く、数値を入れていない（この場合、値は null にする）
- 会社の実績が無い数値を、実績らしく書いてはいけません。
- 経営目標から逆算した必要件数（例：目標額 ÷ 1件あたりの単価）と、実際に獲得できると見込む件数（仮説）は、別の数値として rationale に分けて書いてください。

## 出力の追加項目
- causalChain：上の6項目に対応する文章（キー：${CAUSAL_KEYS.join('、')}）
- assumptionBasis：前提ごとの根拠区分（キーは assumptions と同じ名前）
- verificationItems：利用者に確認してほしい数値・根拠の一覧（最大8件）`;

/** JSON出力例に足す項目（REASONING_RULES と対応） */
export const REASONING_OUTPUT_FIELDS = `  "causalChain": {
    "customer": "どの顧客の何の課題か",
    "problem": "課題が起きている理由",
    "whyUs": "なぜ自社が選ばれるか",
    "actions": "誰に何をするか",
    "outcome": "生まれる成果",
    "moneyPath": "売上・利益へのつながり",
    "verifyNumbers": "確認すべき数値"
  },
  "assumptionBasis": {
    "targetCustomers": "HYPOTHESIS"
  },
  "verificationItems": ["確認する数値や根拠"],
`;

export type SanitizedReasoning = {
  causalChain?: CausalChain;
  assumptionBasis?: Record<string, AssumptionBasis>;
  verificationItems: string[];
};

/** AIの返却値の追加項目を検査する。型が違う項目は捨てる（AIの値を実績として扱わない） */
export function sanitizeDraftReasoning(raw: any): SanitizedReasoning {
  const out: SanitizedReasoning = { verificationItems: [] };
  if (raw?.causalChain && typeof raw.causalChain === 'object' && !Array.isArray(raw.causalChain)) {
    const c: CausalChain = {};
    for (const k of CAUSAL_KEYS) {
      const v = raw.causalChain[k];
      if (typeof v === 'string' && v.trim()) c[k] = v.trim().slice(0, 300);
    }
    if (Object.keys(c).length) out.causalChain = c;
  }
  if (raw?.assumptionBasis && typeof raw.assumptionBasis === 'object' && !Array.isArray(raw.assumptionBasis)) {
    const b: Record<string, AssumptionBasis> = {};
    for (const [k, v] of Object.entries(raw.assumptionBasis)) {
      if (typeof v === 'string' && (ASSUMPTION_BASIS as readonly string[]).includes(v)) b[k] = v as AssumptionBasis;
    }
    if (Object.keys(b).length) out.assumptionBasis = b;
  }
  if (Array.isArray(raw?.verificationItems)) {
    out.verificationItems = raw.verificationItems
      .filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '')
      .map((x: string) => x.trim().slice(0, 200))
      .slice(0, 8);
  }
  return out;
}
