/* v1（Phase 2C の保存済み出力）→ v2 への移行。
 * 方針：情報を黙って消さない。変換したものは log に残し、移行で補えないもの（障害・行動の因果）は補わない。
 * 補えないものは、v2 の検証で欠落としてエラーになる。 */
import type { FinanceRole } from './types';

export type MigrationNote = { path: string; action: string };
export type MigrationResult = { json: Record<string, any>; log: MigrationNote[] };

const LEGACY_FINANCE_INPUTS: Record<string, { role: FinanceRole; label: string; unit: string }> = {
  meetingsPerPeriod: { role: 'MEETINGS', label: '商談数', unit: '件' },
  winRatePct: { role: 'WIN_RATE', label: '受注率', unit: '%' },
  averageDealYen: { role: 'AVG_DEAL', label: '平均受注額', unit: '円' },
  quantity: { role: 'QUANTITY', label: '数量', unit: '単位未指定' },
  unitPriceYen: { role: 'UNIT_PRICE', label: '単価', unit: '円' },
  directAmountYen: { role: 'DIRECT_AMOUNT', label: '直接金額', unit: '円' },
  trialInvestmentCost: { role: 'OTHER', label: '試験導入の投資額', unit: '円' },
  recoveryPeriod: { role: 'OTHER', label: '回収期間', unit: 'ヶ月' },
  wasteAmount: { role: 'OTHER', label: '廃棄額', unit: '円' },
  materialCostAmount: { role: 'OTHER', label: '原材料費', unit: '円' },
  improvementAmount: { role: 'OTHER', label: '改善額', unit: '円' },
  conversionRate: { role: 'CONVERSION_RATE', label: '転換率', unit: '%' },
  retentionRate: { role: 'RETENTION_RATE', label: '定着率', unit: '%' },
  unitPrice: { role: 'UNIT_PRICE', label: '単価（自由記載）', unit: '円' },
};

const BASES = ['STAGE_DATA', 'DERIVED', 'HYPOTHESIS', 'PROPOSAL', 'UNCONFIRMED'];
const RANGE = /(\d{4}-\d{2})\s*[〜~～-]\s*(\d{4}-\d{2})/;

export function migrateV1ToV2(v1: Record<string, any>): MigrationResult {
  const log: MigrationNote[] = [];
  const j = JSON.parse(JSON.stringify(v1));

  // 確認事項：文字列・オブジェクトの混在を、オブジェクトに統一する。優先度は期限の早いものから3件
  const items: Array<{ item: string; confirmBy: string | null; sourceRefs: string[] }> = (j.verificationItems ?? []).map(
    (v: unknown, i: number) => {
      if (typeof v === 'string') {
        log.push({ path: `verificationItems[${i}]`, action: '文字列を {item} の形に統一' });
        return { item: v, confirmBy: null, sourceRefs: [] };
      }
      const o = v as { item?: string; confirmBy?: string; sourceRefs?: string[] };
      return { item: o.item ?? JSON.stringify(v), confirmBy: o.confirmBy ?? null, sourceRefs: o.sourceRefs ?? [] };
    }
  );
  const order = items
    .map((it, i) => ({ i, key: it.confirmBy ?? '9999-99' }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
    .slice(0, 3)
    .map((x) => x.i);
  j.verificationItems = items.map((it, i) => {
    const priority = order.includes(i) ? 'BEFORE_START' : 'DETAIL';
    if (priority === 'BEFORE_START') log.push({ path: `verificationItems[${i}]`, action: '期限の早い3件を実行前の確認（BEFORE_START）に設定（移行規則）' });
    return { item: it.item, priority, confirmBy: it.confirmBy, sourceRefs: it.sourceRefs };
  });

  // 仮期間：文字列は終了年月を取り出す。開始年月は理由欄に残す（捨てない）
  if (typeof j.provisionalPeriod === 'string') {
    const m = j.provisionalPeriod.match(RANGE);
    log.push({ path: 'provisionalPeriod', action: '文字列を {endYm, reason} に変換。原文は reason に残す' });
    j.provisionalPeriod = m
      ? { endYm: m[2], reason: `（移行）${j.provisionalPeriod}` }
      : null;
    if (!m) log.push({ path: 'provisionalPeriod', action: '終了年月を読めないため null（情報は移行ログに残す）' });
  } else if (j.provisionalPeriod && typeof j.provisionalPeriod === 'object') {
    const p = j.provisionalPeriod as { endYm?: string; reason?: string; startYm?: string };
    const extra = p.startYm ? `（AI出力の開始年月 ${p.startYm}）` : '';
    if (p.startYm) log.push({ path: 'provisionalPeriod.startYm', action: '開始年月は計画側で決まるため、理由欄へ移した' });
    j.provisionalPeriod = { endYm: p.endYm, reason: `${p.reason ?? ''}${extra}` };
  }

  // 障害・行動の因果：v1 には無い。補わず、空として残す（検証で欠落になる）
  j.section1 = j.section1 ?? {};
  if (!Array.isArray(j.section1.obstacles)) {
    j.section1.obstacles = [];
    log.push({ path: 'section1.obstacles', action: 'v1 に無い。空配列にした（補えない。検証で欠落として検出）' });
  }
  for (const [i, a] of (j.section2?.actions ?? []).entries()) {
    if (a.mechanism === undefined) {
      a.mechanism = null;
      log.push({ path: `section2.actions[${i}].mechanism`, action: 'v1 に無い。null にした（補えない。検証で欠落として検出）' });
    }
  }

  // 財務入力：固定キーの連想配列を、役割・単位・根拠・確認状態を持つ配列に変換する（自由項目も残す）
  for (const [i, f] of (j.section4?.financeItems ?? []).entries()) {
    const entries = Object.entries(f.inputs ?? {}) as Array<[string, any]>;
    f.inputs = entries.map(([name, v]) => {
      const map = LEGACY_FINANCE_INPUTS[name] ?? { role: 'OTHER' as FinanceRole, label: name, unit: '未指定' };
      if (!LEGACY_FINANCE_INPUTS[name]) log.push({ path: `section4.financeItems[${i}].inputs.${name}`, action: '未知の入力名。OTHER の自由項目として保持' });
      else log.push({ path: `section4.financeItems[${i}].inputs.${name}`, action: `役割 ${map.role}（${map.label}）に変換` });
      return {
        role: map.role,
        label: map.label,
        value: v.value ?? null,
        unit: map.unit,
        basis: BASES.includes(v.basis) ? v.basis : 'UNCONFIRMED',
        confirmState: 'UNCONFIRMED',
        sourceRefs: v.sourceRefs ?? [],
      };
    });
    f.freeNote = null;
  }

  // 責任者の根拠区分：自由記述は note へ移し、根拠区分は UNCONFIRMED にする
  const r = j.section5?.responsible;
  if (r) {
    if (!BASES.includes(r.basis)) {
      log.push({ path: 'section5.responsible.basis', action: '自由記述を note に移し、根拠区分を UNCONFIRMED にした' });
      r.note = r.basis;
      r.basis = 'UNCONFIRMED';
    } else {
      r.note = null;
    }
  }

  return { json: j, log };
}
