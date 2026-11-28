/* AIが入力・操作した対象（data-ai-target）を、画面のどのタブ・折りたたみ欄・事業の選択で見せるかを決める。
 * 対象の名前（stage1.*）と1対1で対応させる。STAGE2〜6で再利用する場合は、ここに対応を足す。 */
export type RevealTab = 'input' | 'analysis';

/** 表示の切り替えを行う期間（これより古い指示では、欄の開閉やタブを変えない） */
// 反映の後、自動保存の待機（最大6秒）を経てから画面を移動するため、移動後も十分に有効な期間にする
export const REVEAL_FRESH_MS = 20000;

export type Reveal = {
  tab: RevealTab;
  /** SectionCard の id（page.tsx の折りたたみ欄） */
  section: string;
  /** 事業別財務の表示先（事業の id） */
  segmentId?: string;
};

export function revealOf(target: string): Reveal | null {
  // 削除の後も残る一覧（事業セグメント定義・次の一手（論点））を示す
  if (target === 'stage1.segments') return { tab: 'input', section: 'company' };
  if (target === 'stage1.issues') return { tab: 'analysis', section: 'issues' };
  if (target.startsWith('stage1.profile.') || target.startsWith('stage1.segment.')) {
    return { tab: 'input', section: 'company' };
  }
  const segment = target.match(/^stage1\.finance\.segment\.([^.]+)\./);
  if (segment) return { tab: 'input', section: 'finance', segmentId: segment[1] };
  if (target.startsWith('stage1.finance.pl.') || target.startsWith('stage1.finance.bs.')) {
    return { tab: 'input', section: 'finance' };
  }
  if (target === 'stage1.assumption.wacc') return { tab: 'input', section: 'wacc' };
  if (target === 'stage1.valuation') return { tab: 'analysis', section: 'metrics' };
  if (target.startsWith('stage1.issue.') || target === 'stage1.handover') {
    return { tab: 'analysis', section: 'issues' };
  }
  return null;
}
