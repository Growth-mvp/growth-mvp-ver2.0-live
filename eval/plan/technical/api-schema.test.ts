import { writeFileSync } from 'fs';
import path from 'path';
import { auditStrictSchema, buildPlanApiSchema } from '@/lib/stage4/plan/apiSchema';

describe('API向け厳格JSON Schema（Structured Outputs）', () => {
  const api = buildPlanApiSchema();

  it('厳格モードの基本条件（全項目を required、additionalProperties: false）を満たす', () => {
    expect(auditStrictSchema(api.schema)).toEqual([]);
  });

  it('使われているキーワードを列挙し、報告用に保存する', () => {
    const used = new Set<string>();
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') for (const [k, v] of Object.entries(n as object)) { used.add(k); walk(v); }
    };
    walk(api.schema);
    const dir = path.join(__dirname, '..', 'results-phase2e');
    require('fs').mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'api-schema.json'), JSON.stringify(api, null, 2), 'utf8');
    expect(used.has('$ref') || used.has('$defs')).toBe(false);
    console.log('keywords:', [...used].sort().join(', '));
  });
});
