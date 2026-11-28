import { useStrategyStore } from '@/store/strategyStore';
import { saveStatusTypeOf, type SaveStatusType } from '@/lib/strategy/saveStatus';

const SETTLE_TIMEOUT_MS = 6000;
const POLL_MS = 150;

/** 反映の直後の自動保存（保存中を含む）が終わるまで待ち、その時点の画面の保存状態を返す */
export async function waitForSaveSettled(timeoutMs = SETTLE_TIMEOUT_MS): Promise<SaveStatusType> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = saveStatusTypeOf(useStrategyStore.getState());
    if (status !== 'dirty' && status !== 'saving') return status;
    if (Date.now() >= deadline) return status;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** 画面左下の表示と同じ判定に基づく説明。「保存」と言うのは保存済みのときだけ */
export function saveSentenceOf(status: SaveStatusType): string {
  switch (status) {
    case 'saved':
      return '画面左下の表示は「保存済み」です。';
    case 'dirty':
      return '保存はまだです。画面左下の「保存」を押すと保存されます。';
    case 'saving':
      return '保存中です。画面左下の表示で完了を確認してください。';
    case 'error':
      return '保存に失敗しました。画面左下の表示を確認して、もう一度「保存」を押してください。';
  }
}
