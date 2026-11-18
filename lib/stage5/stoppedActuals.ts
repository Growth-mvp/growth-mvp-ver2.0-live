/* STAGE5：中止した施策の実績。中止前（中止月を含む）の月は実績を登録できるが、中止月より後の月は登録できない。
 * 施策の状態の判定は lib/cascade/projectLifecycle の lifecycleOf を使う（中止日は stoppedAt、無ければ changedAt）。
 * 除外（計画から外す）の施策は、実績の登録の一覧に出さない。 */
import { isProjectStopped, lifecycleOf } from '@/lib/cascade/projectLifecycle';

const YM_HEAD = /^(\d{4})-(\d{2})/;

/** 中止した施策について、実績を登録できる最後の年月（YYYY-MM）。中止していない施策は null（上限なし） */
export function actualMaxYmOf(project: unknown): string | null {
  if (!isProjectStopped(project)) return null;
  const life = lifecycleOf(project);
  const m = YM_HEAD.exec(String(life?.stoppedAt ?? life?.changedAt ?? ''));
  return m ? `${m[1]}-${m[2]}` : null;
}

/** 年月（YYYY-MM）が上限より後なら、理由の文言を返す。問題なければ null */
export function monthAfterLimit(ym: string, maxYm: string | null | undefined): string | null {
  if (!maxYm || !/^\d{4}-\d{2}$/.test(ym)) return null;
  return ym > maxYm ? `中止した月（${maxYm}）より後の実績は登録できません。` : null;
}

/** 施策について、この年月の実績を登録してよいか。登録できないときは理由を返す */
export function actualMonthRefusal(project: unknown, ym: string): string | null {
  return monthAfterLimit(ym, actualMaxYmOf(project));
}

/** 実績の登録の一覧に出すか。除外は出さず、中止は中止前の実績を登録するため出す */
export const isListedOnExecution = (project: unknown): boolean => lifecycleOf(project)?.status !== 'EXCLUDED';
