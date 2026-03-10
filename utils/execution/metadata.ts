/**
 * Progress log metadata utilities
 * Embed and parse metadata in progress_logs.content field without DB schema changes
 */

export type ProgressLogMetadata = {
  companyId: string;
  deptId: string;
  projectId: string;
  projectKey?: string; // ★ 追加：STAGE6 で executionWeight 検索用（deptName::projectTitle 形式）
  okrId: string;
  krIds?: string[];
  timestamp?: string;
};

/**
 * Build metadata object for progress log
 */
export function buildProgressLogMetadata(args: {
  companyId: string;
  deptName: string;
  projectTitle: string;
  okrId: string;
  krIds?: string[];
  projectKey?: string; // ★ 追加：呼び出し元から明示的に projectKey を受け取ることもできるように
}): ProgressLogMetadata {
  // ★ projectKey が明示的に渡されない場合は deptName::projectTitle で構築
  const projectKey = args.projectKey ?? `${args.deptName}::${args.projectTitle}`;

  return {
    companyId: args.companyId,
    deptId: args.deptName,
    projectId: args.projectTitle,
    projectKey, // ★ 追加：projectKey を保存
    okrId: args.okrId,
    krIds: args.krIds,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Embed metadata as JSON prefix in content
 * Format: __META__:{json}\n{content}
 * Ensures body is always preserved (never just metadata)
 * JSON.stringify ensures single-line metadata (newlines are escaped as \n)
 */
export function embedMetadata(metadata: ProgressLogMetadata, content: string): string {
  const metaJson = JSON.stringify(metadata);
  const body = String(content ?? '');
  return `__META__:${metaJson}\n${body}`;
}

/**
 * Parse metadata from content if present
 * Returns metadata object and remaining text
 * Backward compatible: old logs without __META__ prefix return metadata: null
 */
export function parseMetadata(content: string): {
  metadata: ProgressLogMetadata | null;
  text: string;
} {
  if (!content || !content.startsWith('__META__:')) {
    return { metadata: null, text: content };
  }

  const newlineIdx = content.indexOf('\n');
  if (newlineIdx === -1) {
    return { metadata: null, text: content };
  }

  const metaStr = content.slice(9, newlineIdx); // Skip "__META__:"
  const text = content.slice(newlineIdx + 1);

  try {
    const metadata = JSON.parse(metaStr) as ProgressLogMetadata;
    return { metadata, text };
  } catch (e) {
    console.warn('[parseMetadata] Failed to parse:', e);
    return { metadata: null, text: content };
  }
}
