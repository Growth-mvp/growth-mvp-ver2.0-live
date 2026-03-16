// /app/debug/backfill/page.tsx
'use client';

/**
 * Debug admin page for running OKR backfill
 *
 * アクセス: /debug/backfill
 * 用途:
 * - Dry-run 実行と結果表示
 * - Validation queries 実行
 * - 実際の backfill 実行（要確認）
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface BackfillStats {
  totalProcessed: number;
  backfilled: number;
  skipped: {
    noDepartmentId: number;
    noProjectId: number;
    noObjective: number;
    invalidOwnerUuid: number;
  };
  errors: string[];
}

interface BackfillResult {
  success: boolean;
  dryRun: boolean;
  stats: BackfillStats;
  skipReport: any[];
  okrsPreview?: any[];
  totalOkrsPrepared: number;
  timestamp: string;
}

export default function BackfillDebugPage() {
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBackfill = async (dryRun: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/debug/backfill-okrs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Backfill failed');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle>OKR Backfill Debug</CardTitle>
          <CardDescription>Phase 2A-3: strategy_data → okrs table migration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Control buttons */}
          <div className="flex gap-4">
            <Button
              onClick={() => runBackfill(true)}
              disabled={loading}
              variant="outline"
            >
              {loading ? 'Running...' : 'Run DRY-RUN'}
            </Button>
            <Button
              onClick={() => runBackfill(false)}
              disabled={loading}
              variant="destructive"
              onClick={() => {
                if (
                  !confirm(
                    '警告: This will actually insert OKRs into the okrs table. Continue?'
                  )
                ) return;
                runBackfill(false);
              }}
            >
              {loading ? 'Running...' : 'Run ACTUAL BACKFILL'}
            </Button>
          </div>

          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-semibold">Error</p>
              <p className="text-red-700 mt-2">{error}</p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">
                  <strong>Mode:</strong> {result.dryRun ? 'DRY-RUN' : 'ACTUAL'}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Status:</strong>{' '}
                  <span className={result.success ? 'text-green-600' : 'text-red-600'}>
                    {result.success ? 'SUCCESS' : 'FAILED'}
                  </span>
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Timestamp:</strong> {new Date(result.timestamp).toLocaleString()}
                </p>
              </div>

              {/* Stats summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Processed</p>
                  <p className="text-2xl font-bold">{result.stats.totalProcessed}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Backfilled</p>
                  <p className="text-2xl font-bold text-green-600">
                    {result.stats.backfilled}
                  </p>
                </div>
              </div>

              {/* Skip statistics */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="font-semibold text-yellow-900 mb-3">Skip Report</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-yellow-700">No Department ID</p>
                    <p className="text-lg font-bold">{result.stats.skipped.noDepartmentId}</p>
                  </div>
                  <div>
                    <p className="text-yellow-700">No Project ID</p>
                    <p className="text-lg font-bold">{result.stats.skipped.noProjectId}</p>
                  </div>
                  <div>
                    <p className="text-yellow-700">No Objective</p>
                    <p className="text-lg font-bold">{result.stats.skipped.noObjective}</p>
                  </div>
                  <div>
                    <p className="text-yellow-700">Invalid Owner UUID</p>
                    <p className="text-lg font-bold">{result.stats.skipped.invalidOwnerUuid}</p>
                  </div>
                </div>
              </div>

              {/* Errors */}
              {result.stats.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="font-semibold text-red-900 mb-2">Errors ({result.stats.errors.length})</p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {result.stats.errors.map((err, i) => (
                      <li key={i}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Skip report details */}
              {result.skipReport && result.skipReport.length > 0 && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="font-semibold text-gray-900 mb-3">
                    Skip Report Details ({result.skipReport.length} items)
                  </p>
                  <div className="max-h-96 overflow-y-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Strategy ID</th>
                          <th className="text-left p-2">Department</th>
                          <th className="text-left p-2">Project</th>
                          <th className="text-left p-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.skipReport.map((item, i) => (
                          <tr key={i} className="border-b hover:bg-gray-100">
                            <td className="p-2 font-mono text-gray-700">
                              {item.strategyId?.slice(0, 8)}...
                            </td>
                            <td className="p-2">{item.departmentId || '—'}</td>
                            <td className="p-2">{item.projectId || '—'}</td>
                            <td className="p-2 text-gray-600">{item.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* OKRs preview */}
              {result.okrsPreview && result.okrsPreview.length > 0 && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="font-semibold text-gray-900 mb-3">
                    OKR Preview (first 5 of {result.totalOkrsPrepared})
                  </p>
                  <div className="space-y-3">
                    {result.okrsPreview.map((okr, i) => (
                      <div key={i} className="bg-white p-3 rounded border border-gray-200">
                        <p className="text-sm font-mono text-gray-600">
                          ID: {okr.id?.slice(0, 8)}...
                        </p>
                        <p className="text-sm font-semibold mt-1">{okr.objective}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          Dept: {okr.department_id} | Proj: {okr.project_id}
                        </p>
                        {okr.owner_name && (
                          <p className="text-xs text-gray-600">Owner: {okr.owner_name}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-semibold mb-1">1. Run DRY-RUN</p>
            <p className="text-gray-600">
              Click "Run DRY-RUN" to see what OKRs would be migrated without actually inserting anything.
            </p>
          </div>
          <div>
            <p className="font-semibold mb-1">2. Review Results</p>
            <p className="text-gray-600">
              Check the stats and skip report to understand how many OKRs will be migrated and how many will be skipped (and why).
            </p>
          </div>
          <div>
            <p className="font-semibold mb-1">3. Run ACTUAL BACKFILL (if satisfied)</p>
            <p className="text-gray-600">
              After reviewing the dry-run results, click "Run ACTUAL BACKFILL" to insert OKRs into the okrs table.
            </p>
          </div>
          <div>
            <p className="font-semibold mb-1">注意</p>
            <p className="text-gray-600">
              - Backfill は idempotent です（同じデータで複数回実行しても安全）
              - department.id と project.id がない OKR はスキップされます
              - source_okr_id で元のデータへの参照を保持します
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
