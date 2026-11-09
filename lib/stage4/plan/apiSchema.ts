/* API向けの厳格な JSON Schema（Structured Outputs, strict: true）。
 * SDK 同梱の変換（openai/helpers/zod）で PlanDraftSchema から作り、厳格モードの条件に合うかを監査する。
 * 文字数・件数・正規表現の制約は、API側では省略する（厳格モードの対応範囲が確定していないため）。
 * その分の検証は Zod（PlanDraftSchema.parse）が必ず行う。API側は Zod より緩くなることはあっても、厳しくはならない。 */
import { zodResponseFormat } from 'openai/helpers/zod';
import { PlanDraftSchema } from './types';

type JsonNode = Record<string, any>;

/** 厳格モードで API に送らない制約（Zod 側で検証する） */
const OMITTED_KEYWORDS = new Set(['minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'minItems', 'maxItems', 'format']);

function stripOmitted(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripOmitted);
  if (node && typeof node === 'object') {
    const out: JsonNode = {};
    for (const [k, v] of Object.entries(node as JsonNode)) {
      if (OMITTED_KEYWORDS.has(k) || k === '$schema') continue;
      out[k] = stripOmitted(v);
    }
    // OpenAPI 形式の nullable: true は、標準の型の配列（[T, 'null']）に直す
    if (out.nullable === true && typeof out.type === 'string') {
      out.type = [out.type, 'null'];
    }
    delete out.nullable;
    return out;
  }
  return node;
}

/** $ref（$defs）を本体に展開する。同じ定義を繰り返し使うため、参照は再帰を含まない */
function inlineRefs(node: unknown, defs: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map((v) => inlineRefs(v, defs));
  if (node && typeof node === 'object') {
    const n = node as JsonNode;
    if (typeof n.$ref === 'string') {
      const name = n.$ref.split('/').pop() as string;
      if (!(name in defs)) throw new Error(`参照先が無い: ${n.$ref}`);
      return inlineRefs(defs[name], defs);
    }
    const out: JsonNode = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === '$defs' || k === 'definitions') continue;
      out[k] = inlineRefs(v, defs);
    }
    return out;
  }
  return node;
}

export function buildPlanApiSchema(): { name: string; strict: true; schema: JsonNode } {
  const rf = zodResponseFormat(PlanDraftSchema, 'execution_plan_draft');
  const raw = rf.json_schema.schema as JsonNode;
  const defs = { ...(raw.$defs ?? {}), ...(raw.definitions ?? {}) };
  const { $defs: _d, definitions: _e, ...root } = raw;
  const schema = stripOmitted(inlineRefs(root, defs)) as JsonNode;
  return { name: 'execution_plan_draft', strict: true, schema };
}

/** 厳格モードの基本条件を満たすかを調べ、違反の場所を返す（空配列なら満たす） */
export function auditStrictSchema(schema: JsonNode): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node) && 'nullable' in (node as JsonNode)) {
      problems.push(`${path}: 非標準の nullable が残っている`);
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as JsonNode;
    const isObject = n.type === 'object' || (n.properties && typeof n.properties === 'object');
    if (isObject && n.properties) {
      const keys = Object.keys(n.properties);
      if (n.additionalProperties !== false) problems.push(`${path}: additionalProperties が false でない`);
      const required: string[] = Array.isArray(n.required) ? n.required : [];
      const missing = keys.filter((k) => !required.includes(k));
      if (missing.length) problems.push(`${path}: required に無い項目 ${missing.join(',')}`);
    }
    for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
  };
  walk(schema, '$');
  return problems;
}
