/* strategy_data の全列が「初期化」か「保持」のどちらかに分類されていることを、リポジトリ内の定義から確認する。 */
import fs from 'fs';
import path from 'path';
import { STRATEGY_DATA_PRESERVED_COLUMNS, STRATEGY_DATA_RESET_VALUES } from './companyDataReset';

jest.mock('server-only', () => ({}));

const root = path.resolve(__dirname, '..', '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const sqlFilesIn = (dir: string) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read(`${dir}/${f}`));

function columnsFromSchemaDump(sql: string): string[] {
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS "public"."strategy_data" (');
  const end = sql.indexOf('\n);', start);
  return sql
    .slice(start, end)
    .split('\n')
    .map((line) => line.match(/^\s+"(\w+)"\s/)?.[1])
    .filter((c): c is string => !!c);
}

function columnsFromMigrations(files: string[]): string[] {
  const columns: string[] = [];
  for (const sql of files) {
    for (const statement of sql.matchAll(/ALTER TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?strategy_data"?\s[\s\S]*?;/gi)) {
      for (const add of statement[0].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi)) {
        columns.push(add[1]);
      }
    }
  }
  return columns;
}

function columnsFromFieldMap(source: string): string[] {
  const start = source.indexOf('const FIELD_MAP');
  const end = source.indexOf('};', start);
  return [...source.slice(start, end).matchAll(/:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

const knownColumns = new Set([
  ...columnsFromSchemaDump(read('supabase/schema_remote_20260708.sql')),
  ...columnsFromMigrations([...sqlFilesIn('supabase/migrations'), ...sqlFilesIn('supabase/pending')]),
  ...columnsFromFieldMap(read('utils/supabase/strategy.ts')),
]);

const classifiedColumns = new Set([
  ...Object.keys(STRATEGY_DATA_RESET_VALUES),
  ...STRATEGY_DATA_PRESERVED_COLUMNS,
]);

describe('全削除の対象列（strategy_data）', () => {
  it('スキーマ・マイグレーション・保存マッピングのすべての列が、初期化か保持のどちらかに分類されている', () => {
    const unclassified = [...knownColumns].filter((c) => !classifiedColumns.has(c)).sort();
    expect(unclassified).toEqual([]);
  });

  it('分類に書かれた列は、実在する列だけである', () => {
    const unknown = [...classifiedColumns].filter((c) => !knownColumns.has(c)).sort();
    expect(unknown).toEqual([]);
  });

  it('初期化する列と保持する列が重ならない', () => {
    const overlap = STRATEGY_DATA_PRESERVED_COLUMNS.filter((c) => c in STRATEGY_DATA_RESET_VALUES);
    expect(overlap).toEqual([]);
  });

  it('editable_cascade（保存先の列）を初期化対象に含める', () => {
    expect('editable_cascade' in STRATEGY_DATA_RESET_VALUES).toBe(true);
    expect('final_story_conclusion' in STRATEGY_DATA_RESET_VALUES).toBe(true);
    expect('stage1_benchmarks' in STRATEGY_DATA_RESET_VALUES).toBe(true);
  });
});
