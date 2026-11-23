import React, { useState } from 'react';
import { candidatePoolOf, type PoolCandidate } from '@/lib/swot/candidatePool';
import { DISCOVERY_VIEWPOINTS, VIEWPOINT_LABEL_JA } from '@/lib/swot/opportunityGroups';
import {
  OPPORTUNITY_CAP,
  detailRowsOf,
  discoveryPathLabel,
  evidenceViewOf,
  extendPlanOf,
  groupByViewpoint,
  selectedEntryOf,
  type GroupedByViewpoint,
} from '@/lib/swot/candidateView';

type Source = { index: number; title?: string; url?: string; retrievedAt?: string };

export type SwotOpportunityPanelProps = {
  suggestions?: {
    opportunity?: string[];
    threat?: string[];
    sources?: unknown;
    candidatePool?: unknown;
    selection?: unknown;
    evidence?: unknown;
  };
  locked: boolean;
  extending: boolean;
  extendMessage: string | null;
  extendError: string | null;
  onExtend: () => void;
  onAdd: (candidateId: string) => void;
  onRemove: (candidateId: string) => void;
  onEdit: (candidateId: string, text: string) => void;
};

const EVIDENCE_STYLE: Record<string, string> = {
  confirmed: 'bg-success-soft text-success xl:dark:bg-success/30 xl:dark:text-accent-soft',
  reference: 'bg-accent-soft text-accent-ink xl:dark:bg-accent-action/20 xl:dark:text-accent-soft',
  hypothesis: 'bg-bluegray-mist text-bluegray-deep xl:dark:bg-bluegray-deep/30 xl:dark:text-bluegray-light',
  mismatch: 'bg-caution-soft text-caution xl:dark:bg-caution/30 xl:dark:text-caution-soft',
};

export function SwotOpportunityPanel(props: SwotOpportunityPanelProps) {
  const { suggestions, locked, extending, extendMessage, extendError, onExtend, onAdd, onRemove, onEdit } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (!suggestions || (!Array.isArray(suggestions.opportunity) && !Array.isArray(suggestions.threat))) return null;

  const pool = candidatePoolOf(suggestions as never).candidates;
  const opportunities = pool.filter((c) => c.kind === 'opportunity');
  const threats = pool.filter((c) => c.kind === 'threat');
  const grouped = groupByViewpoint(opportunities);
  const groupedThreats = groupByViewpoint(threats);
  const sources = Array.isArray(suggestions.sources) ? (suggestions.sources as Source[]) : [];
  const plan = extendPlanOf({ count: opportunities.length, busy: extending, locked });

  if (opportunities.length === 0 && threats.length === 0) return null;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (c: PoolCandidate) => {
    const selected = selectedEntryOf(suggestions, c.id);
    const evidence = evidenceViewOf(c);
    const isOpen = expanded.has(c.id);
    const isEditing = editingId === c.id;
    const btn = 'bg-accent-soft text-accent-ink hover:bg-accent-soft/70';
    return (
      <li key={c.id} className="rounded-lg bg-white/60 xl:dark:bg-white/5 p-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded border border-gray-300 p-2 text-sm text-gray-800"
                rows={2}
                maxLength={1000}
              />
            ) : (
              <p className="text-sm text-gray-800 xl:dark:text-gray-200">{c.text}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{discoveryPathLabel(c)}</span>
              <span className={`rounded px-1.5 py-0.5 ${EVIDENCE_STYLE[evidence.kind]}`}>{evidence.label}</span>
              {selected && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent-ink">SWOTに追加済み</span>}
              {c.origin === 'extension' && <span className="rounded bg-bluegray-mist px-1.5 py-0.5 text-bluegray-deep">追加探索</span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {selected ? (
              isEditing ? (
                <>
                  <button
                    disabled={locked}
                    onClick={() => {
                      onEdit(c.id, draft);
                      setEditingId(null);
                    }}
                    className="px-3 py-1 rounded-lg bg-accent-action text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button onClick={() => setEditingId(null)} className="px-3 py-1 rounded-lg border text-xs">
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={locked}
                    onClick={() => {
                      setEditingId(c.id);
                      setDraft(selected.text);
                    }}
                    className="px-3 py-1 rounded-lg border text-xs disabled:opacity-50"
                  >
                    編集
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => onRemove(c.id)}
                    className="px-3 py-1 rounded-lg border border-danger/40 text-danger text-xs disabled:opacity-50"
                  >
                    外す
                  </button>
                </>
              )
            ) : (
              <button
                disabled={locked}
                onClick={() => onAdd(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap disabled:opacity-50 ${btn}`}
              >
                追加
              </button>
            )}
            <button onClick={() => toggle(c.id)} className="px-3 py-1 rounded-lg text-xs text-blue-700 underline">
              {isOpen ? '閉じる' : '詳細'}
            </button>
          </div>
        </div>
        {isOpen && (
          <dl className="mt-3 space-y-1 border-t border-gray-200 pt-3 text-xs">
            {detailRowsOf(c, sources).map((row) => (
              <div key={row.label} className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="text-gray-500">{row.label}</dt>
                <dd className="whitespace-pre-line text-gray-700 xl:dark:text-gray-300">{row.value ?? '記録なし'}</dd>
              </div>
            ))}
          </dl>
        )}
      </li>
    );
  };

  const renderViewpointSections = (byViewpoint: GroupedByViewpoint) => {
    const headingClass = 'text-bluegray-deep xl:dark:text-bluegray-light';
    return (
      <div className="space-y-4">
        {DISCOVERY_VIEWPOINTS.map((v) => (
          <section key={v}>
            <h5 className={`mb-2 text-sm font-medium ${headingClass}`}>
              {VIEWPOINT_LABEL_JA[v]}（{byViewpoint[v].length}件）
            </h5>
            {byViewpoint[v].length === 0 ? (
              <p className="text-xs text-gray-500">この分類の候補はまだありません。</p>
            ) : (
              <ul className="space-y-2">{byViewpoint[v].map((c) => renderRow(c))}</ul>
            )}
          </section>
        ))}
        {byViewpoint.unclassified.length > 0 && (
          <section>
            <h5 className="mb-1 text-sm font-medium text-gray-600 xl:dark:text-gray-400">
              分類未設定の候補（{byViewpoint.unclassified.length}件）
            </h5>
            <p className="mb-2 text-xs text-gray-500">分類の記録がないため、分類は推定せず暫定的に表示しています。</p>
            <ul className="space-y-2">{byViewpoint.unclassified.map((c) => renderRow(c))}</ul>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-zinc-200 xl:dark:border-bluegray-deep/60 bg-white xl:dark:bg-white/5 p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-base font-semibold text-bluegray-deep xl:dark:text-bluegray-light">提案された機会と脅威</h4>
        <span className="text-xs text-gray-600">
          機会 {opportunities.length} / {OPPORTUNITY_CAP}件
        </span>
      </div>

      {opportunities.length > 0 && <div className="mb-6">{renderViewpointSections(grouped)}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!plan.enabled}
          onClick={onExtend}
          className="px-4 py-2 rounded-lg border border-accent-action/40 bg-white text-sm font-medium text-accent-ink hover:bg-accent-soft disabled:opacity-50"
        >
          {extending ? '追加探索中…' : plan.batch > 0 ? `さらに探索（最大${plan.batch}件）` : 'さらに探索'}
        </button>
        {!plan.enabled && plan.reason && <span className="text-xs text-gray-600">{plan.reason}</span>}
        {extendMessage && <span className="text-xs text-success">{extendMessage}</span>}
        {extendError && <span className="text-xs text-danger">{extendError}</span>}
      </div>

      {threats.length > 0 && (
        <div>
          <h5 className="mb-3 text-sm font-medium text-bluegray-deep xl:dark:text-bluegray-light">提案された脅威</h5>
          {renderViewpointSections(groupedThreats)}
        </div>
      )}
    </div>
  );
}
