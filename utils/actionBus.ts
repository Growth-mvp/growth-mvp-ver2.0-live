// /utils/actionBus.ts
export type DomainEvents = {
  // Q&A / 戦略まわり
  'answers2:updated': {
    strategyId: string;
    chapterIndex: number;
    stepIndex: number;
    answer: string;
  };

  // 部門用：「次の1問を生成して」のトリガー
  'questions:generate:next': {
    strategyId: string;
    chapterIndex: number;     // 部門のインデックス等に利用
    afterStepIndex: number;   // 直前のステップ（0-based, 無ければ -1）
  };

  // ★ 追加：生成完了/失敗の通知（UIのローディング制御に使用）
  'questions:generate:done': {}; // ペイロード不要
  'questions:generate:error': { message?: string };

  // ストーリー関連
  'story:final:generated': { strategyId: string };
  'story:chapters:reordered': { strategyId: string; order: number[] };

  // OKR ログ
  'okr:progress:logged': { strategyId: string; okrId: string; logId: string };

  // プロンプト更新など
  'agent:prompt:refresh': { strategyId: string };

  // ★ 追加済み：チャット送信
  'agent:chat:send': { content: string };
};

declare global {
  // eslint-disable-next-line no-var
  var __actionBus__: EventTarget | undefined;
}

// 単一インスタンス（SSR/CSR間でも多重生成しない）
const target: EventTarget = (globalThis as any).__actionBus__ ?? new EventTarget();
(globalThis as any).__actionBus__ = target;

/** 購読：解除用の関数を返す */
export function on<K extends keyof DomainEvents>(
  type: K,
  handler: (payload: DomainEvents[K]) => void
) {
  const listener = (e: Event) => handler((e as CustomEvent<DomainEvents[K]>).detail);
  target.addEventListener(type as string, listener);
  return () => target.removeEventListener(type as string, listener);
}

/** 発火：型安全に detail を渡す */
export function emit<K extends keyof DomainEvents>(type: K, detail: DomainEvents[K]) {
  target.dispatchEvent(new CustomEvent(type as string, { detail }));
}
