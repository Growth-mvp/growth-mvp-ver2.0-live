/* 検証用のストア：PDF出力のフック（useStage3PdfExport）が読む状態を、検証ハーネスの確定版の内容にする。 */
export function useStrategyStore(): unknown {
  return (globalThis as unknown as { __harnessStore?: unknown }).__harnessStore ?? {};
}
