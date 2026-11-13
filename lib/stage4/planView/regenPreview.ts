type Json = Record<string, unknown>;

/* 保存された草案（ai_draft）から、AIの元の案を取り出す */
export function draftOfBundle(bundle: Json): Json | null {
  if (typeof bundle.rawOutput === 'string') {
    try {
      return JSON.parse(bundle.rawOutput) as Json;
    } catch {
      return null;
    }
  }
  return (bundle.plan as Json) ?? null;
}
