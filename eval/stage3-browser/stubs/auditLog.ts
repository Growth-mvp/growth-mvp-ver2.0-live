export async function logAuditEvent(entry: { action: string; metadata?: unknown }): Promise<boolean> {
  const g = globalThis as unknown as { __audit?: Array<{ action: string; metadata?: unknown }> };
  (g.__audit ??= []).push(entry);
  return true;
}
