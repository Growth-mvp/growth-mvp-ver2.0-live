export type RefetchCoordinator = {
  request: () => Promise<void>;
  markDirty: () => void;
  isDirty: () => boolean;
};

/**
 * 読み込みを直列化し、実行中に来た要求は完了後に 1 回だけ再実行する。
 * 要求を捨てないため、最後に要求された状態は必ず読み込まれる。
 */
export function createRefetchCoordinator(runOnce: () => Promise<void>): RefetchCoordinator {
  let chain: Promise<void> | null = null;
  let dirty = false;

  return {
    request(): Promise<void> {
      if (chain) {
        dirty = true;
        return chain;
      }
      chain = (async () => {
        let failure: { error: unknown } | null = null;
        try {
          do {
            dirty = false;
            failure = null;
            try {
              await runOnce();
            } catch (error) {
              failure = { error };
            }
          } while (dirty);
          if (failure) throw failure.error;
        } finally {
          chain = null;
        }
      })();
      return chain;
    },
    markDirty() {
      dirty = true;
    },
    isDirty() {
      return dirty;
    },
  };
}
