// /app/okr/_hooks/useOkrEditor.ts
'use client';

import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

import {
  ensureArray,
  mkKRStructured,
  buildKRFromText,
  genId,
  type Department,
  type Project,
  type OKR,
  type KRStructuredX,
  type OkrVariant,
  type OkrVariantStatus,
  type StrategyTrack,
  type MetricRole,
  type ValidationPlan,
} from '../_lib/okrModels';

export type EditingMode = 'committed' | 'variant';

export function useOkrEditor(args: {
  editingMode: EditingMode;
  selected: { deptIdx: number; projIdx: number } | null;
  selectedProj: Project | undefined;
  setEditingMode: (m: EditingMode) => void;

  // “ロール影”はUI都合（refetch上書き回避）なので page 側の state を引き継ぐ
  setRoleShadow: (
    updater: (prev: Record<string, Project['role'] | undefined>) => Record<string, Project['role'] | undefined>,
  ) => void;
}) {
  const { editingMode, selectedProj, setEditingMode, setRoleShadow } = args;

  /* -------- 安全更新：常に setState 経由 + dirty=true -------- */
  const patchDepartments = useCallback((mutator: (draft: Department[]) => Department[]) => {
    useStrategyStore.setState((st: any) => {
      const current: Department[] = Array.isArray(st.departments) ? (st.departments as Department[]) : [];
      const next = mutator(current);
      if (next === current) return st;
      return {
        ...st,
        departments: next,
        dirty: true,
      };
    });
  }, []);

  /* ============================================================
   * Project：role（財務レバー：REVENUE/COST/FUTURE）
   * - role 変更時に roleDetail を undefined にリセット（不整合防止）
   * - role === 'FUTURE' の場合は常に roleDetail は undefined
   * ========================================================== */
  const updateProjectRole = useCallback(
    (dIdx: number, pIdx: number, role: Project['role'] | '') => {
      const k = `${dIdx}:${pIdx}`;
      const newRole: Project['role'] | undefined = role === '' ? undefined : (role as Project['role']);

      setRoleShadow((prev) => ({ ...prev, [k]: newRole }));

      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        // role 変更時は常に roleDetail を undefined に（不整合回避）
        const proj = { ...projPrev, role: newRole, roleDetail: undefined };
        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments, setRoleShadow],
  );

  /* ============================================================
   * Project：roleDetail（ロール詳細サブカテゴリ）
   * - role に応じた制約を実装
   *   - REVENUE: ACQ, CHURN, ARPU のみ
   *   - COST: PERSONNEL, FIXED, VARIABLE のみ
   *   - FUTURE or 未設定: 常に undefined（no-op）
   * - 不正値は undefined に矯正（例外throwなし）
   * ========================================================== */
  const updateProjectRoleDetail = useCallback(
    (dIdx: number, pIdx: number, roleDetail: Project['roleDetail'] | '') => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const proj = { ...projPrev };
        const currentRole = proj.role;

        // role に応じた roleDetail の検証と矯正
        let newRoleDetail: Project['roleDetail'] | undefined = undefined;

        if (roleDetail === '') {
          // クリア：undefined にセット
          newRoleDetail = undefined;
        } else if (currentRole === 'REVENUE') {
          // REVENUE: ACQ, CHURN, ARPU のみ許容
          if (['ACQ', 'CHURN', 'ARPU'].includes(roleDetail)) {
            newRoleDetail = roleDetail as Project['roleDetail'];
          } else {
            newRoleDetail = undefined;
          }
        } else if (currentRole === 'COST') {
          // COST: PERSONNEL, FIXED, VARIABLE のみ許容
          if (['PERSONNEL', 'FIXED', 'VARIABLE'].includes(roleDetail)) {
            newRoleDetail = roleDetail as Project['roleDetail'];
          } else {
            newRoleDetail = undefined;
          }
        } else if (currentRole === 'FUTURE') {
          // FUTURE: 常に undefined（roleDetail はセット不可）
          newRoleDetail = undefined;
        } else {
          // role 未設定：roleDetail もセット不可
          newRoleDetail = undefined;
        }

        proj.roleDetail = newRoleDetail;
        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments],
  );

  /* ============================================================
   * Project：旧OKR（互換）
   * ========================================================== */
  const updateProjectOKR = useCallback(
    (dIdx: number, pIdx: number, patch: Partial<OKR>) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const okrs = ensureArray(projPrev.okrs as OKR[] | undefined);
        const first = okrs[0] ?? { id: genId(), objective: '', keyResults: [] };
        okrs[0] = { ...first, id: first.id ?? genId(), ...patch };

        const proj = { ...projPrev, okrs };
        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments],
  );

  /* ============================================================
   * Variant：active
   * ========================================================== */
  const setActiveVariant = useCallback(
    (dIdx: number, pIdx: number, variantId: string) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const proj = { ...projPrev, activeVariantId: variantId };
        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments],
  );

  /* ============================================================
   * Variant：create from committed
   * - 戦略OKR：track/metricRole/validation を保持
   * ========================================================== */
  const createVariantFromCommitted = useCallback(
    (dIdx: number, pIdx: number, opts?: { track?: StrategyTrack; title?: string }) => {
      if (!selectedProj) return;

      const committed = ensureArray(selectedProj.okrsV2 as KRStructuredX[] | undefined);
      const base = committed.map((k) => mkKRStructured({ ...(k as KRStructuredX), id: (k as any).id ?? genId() }));

      const ts = new Intl.DateTimeFormat('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Tokyo',
      }).format(Date.now());

      const track: StrategyTrack | undefined = opts?.track ?? 'EXPLORE';

      const v: OkrVariant = {
        id: genId(),
        title: opts?.title ?? `探索案 ${ts}`,
        status: 'draft',
        createdAt: Date.now(),
        source: 'human',
        winPattern: 'none',
        track,
        levers: undefined,
        okrsV2: base.map((k) =>
          mkKRStructured({
            ...(k as KRStructuredX),
            // 非破壊：無ければ補う
            track: (k as KRStructuredX).track ?? track,
            metricRole: (k as KRStructuredX).metricRole,
            validation:
              (k as KRStructuredX).validation ??
              (track === 'EXPLORE'
                ? { status: 'not_started', hypothesis: '', testMethod: '', evidence: '', nextAction: '' }
                : undefined),
          }),
        ),
        diffFrom: undefined,
      };

      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const list = ensureArray(projPrev.okrVariants);
        const proj: Project = {
          ...projPrev,
          okrVariants: [...list, v],
          activeVariantId: v.id,
        };

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });

      setEditingMode('variant');
    },
    [patchDepartments, selectedProj, setEditingMode],
  );

  const deleteVariant = useCallback(
    (dIdx: number, pIdx: number, variantId: string) => {
      if (!confirm('この探索案を削除します。よろしいですか？')) return;

      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const list = ensureArray(projPrev.okrVariants).filter((v) => v.id !== variantId);
        const nextActive = list[0]?.id;

        const proj: Project = {
          ...projPrev,
          okrVariants: list,
          activeVariantId: projPrev.activeVariantId === variantId ? nextActive : projPrev.activeVariantId,
        };

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });

      setEditingMode('committed');
    },
    [patchDepartments, setEditingMode],
  );

  const renameVariant = useCallback(
    (dIdx: number, pIdx: number, variantId: string, title: string) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const list = ensureArray(projPrev.okrVariants).map((v) => (v.id === variantId ? { ...v, title } : v));

        const proj: Project = { ...projPrev, okrVariants: list };
        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments],
  );

  const setVariantStatus = useCallback(
    (dIdx: number, pIdx: number, variantId: string, status: OkrVariantStatus) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const list = ensureArray(projPrev.okrVariants).map((v) => (v.id === variantId ? { ...v, status } : v));

        const proj: Project = { ...projPrev, okrVariants: list };
        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments],
  );

  /* ============================================================
   * Variant：adopt → committed（財務に反映）
   * - 採用時に okrRevision を進める
   * - adopted ステータスも付与
   * ========================================================== */
  const adoptVariantToCommitted = useCallback(
    (dIdx: number, pIdx: number, variantId: string) => {
      if (!selectedProj) return;
      const list = ensureArray(selectedProj.okrVariants);
      const v = list.find((x) => x.id === variantId);
      if (!v) return;

      if (!confirm('この探索案を「確定版（財務に反映）」として採用します。よろしいですか？')) return;

      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const committedNext = ensureArray(v.okrsV2).map((k) => mkKRStructured({ ...(k as KRStructuredX) }));
        const rev = Number(projPrev.okrRevision ?? 0) + 1;

        const variantsNext = ensureArray(projPrev.okrVariants).map((vv) => {
          if (vv.id !== variantId) return vv;
          return { ...vv, status: 'adopted' as const };
        });

        const proj: Project = {
          ...projPrev,
          okrsV2: committedNext,
          okrRevision: rev,
          okrVariants: variantsNext,
        };

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });

      setEditingMode('committed');
    },
    [patchDepartments, selectedProj, setEditingMode],
  );

  /* ============================================================
   * Structured KR：update/delete/add
   * - committed or active variant を切替
   * - 戦略OKRメタ（track/metricRole/validation）も編集可能
   * ========================================================== */

  const updateStructuredKR = useCallback(
    (dIdx: number, pIdx: number, idx: number, patch: Partial<KRStructuredX>) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const proj = { ...projPrev };

        const ensureStrategicDefaults = (k: KRStructuredX): KRStructuredX => {
          // 非破壊：trackが無ければ project/variant に寄せる
          const fallbackTrack = (k.track ?? proj.track) as StrategyTrack | undefined;
          const nextTrack = patch.track ?? fallbackTrack ?? k.track;

          let validation: ValidationPlan | undefined = (patch.validation ?? k.validation) as any;

          // track を EXPLORE にしたのに validation が無い場合は最低限を補う
          const effectiveTrack = nextTrack ?? k.track;
          if (effectiveTrack === 'EXPLORE' && !validation) {
            validation = { status: 'not_started', hypothesis: '', testMethod: '', evidence: '', nextAction: '' };
          }
          // 逆に EVOLVE で validation を消したい場合はUI側から明示的に validation: undefined を渡す想定

          return {
            ...k,
            ...(patch as KRStructuredX),
            track: nextTrack,
            validation,
          };
        };

        if (editingMode === 'committed') {
          const list = Array.isArray(proj.okrsV2) ? [...(proj.okrsV2 as KRStructuredX[])] : [];
          if (list[idx]) list[idx] = ensureStrategicDefaults({ ...(list[idx] as KRStructuredX) });
          (proj as any).okrsV2 = list;
        } else {
          const vid = proj.activeVariantId;
          if (!vid) return prev;

          const variants = ensureArray(proj.okrVariants).map((v) => {
            if (v.id !== vid) return v;
            const list = Array.isArray(v.okrsV2) ? [...(v.okrsV2 as KRStructuredX[])] : [];
            if (list[idx]) {
              const base = { ...(list[idx] as KRStructuredX) };
              const withFallback: KRStructuredX = {
                ...base,
                track: base.track ?? v.track ?? proj.track,
              };
              list[idx] = ensureStrategicDefaults(withFallback);
            }
            return { ...v, okrsV2: list };
          });

          (proj as any).okrVariants = variants;
        }

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments, editingMode],
  );

  const deleteStructuredKR = useCallback(
    (dIdx: number, pIdx: number, idx: number) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const proj = { ...projPrev };

        if (editingMode === 'committed') {
          const list = Array.isArray(proj.okrsV2) ? (proj.okrsV2 as KRStructuredX[]).filter((_, i) => i !== idx) : [];
          (proj as any).okrsV2 = list;
        } else {
          const vid = proj.activeVariantId;
          if (!vid) return prev;

          const variants = ensureArray(proj.okrVariants).map((v) => {
            if (v.id !== vid) return v;
            const list = Array.isArray(v.okrsV2) ? (v.okrsV2 as KRStructuredX[]).filter((_, i) => i !== idx) : [];
            return { ...v, okrsV2: list };
          });

          (proj as any).okrVariants = variants;
        }

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments, editingMode],
  );

  const addStructuredKR = useCallback(
    (dIdx: number, pIdx: number, kr: KRStructuredX) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const proj = { ...projPrev };

        const withDefaults = mkKRStructured({
          ...(kr as KRStructuredX),
          id: (kr as any).id ?? genId(),
          track: (kr as any).track ?? proj.track,
          metricRole: (kr as any).metricRole,
          validation:
            ((kr as any).track ?? proj.track) === 'EXPLORE'
              ? ((kr as any).validation ?? { status: 'not_started', hypothesis: '', testMethod: '', evidence: '', nextAction: '' })
              : (kr as any).validation,
        });

        if (editingMode === 'committed') {
          const list = Array.isArray(proj.okrsV2) ? [...(proj.okrsV2 as KRStructuredX[])] : [];
          list.push(withDefaults);
          (proj as any).okrsV2 = list;
        } else {
          const vid = proj.activeVariantId;
          if (!vid) return prev;

          const variants = ensureArray(proj.okrVariants).map((v) => {
            if (v.id !== vid) return v;
            const list = Array.isArray(v.okrsV2) ? [...(v.okrsV2 as KRStructuredX[])] : [];
            list.push(
              mkKRStructured({
                ...(withDefaults as KRStructuredX),
                track: (withDefaults as any).track ?? v.track ?? proj.track,
                validation:
                  ((withDefaults as any).track ?? v.track ?? proj.track) === 'EXPLORE'
                    ? ((withDefaults as any).validation ?? {
                        status: 'not_started',
                        hypothesis: '',
                        testMethod: '',
                        evidence: '',
                        nextAction: '',
                      })
                    : (withDefaults as any).validation,
              }),
            );
            return { ...v, okrsV2: list };
          });

          (proj as any).okrVariants = variants;
        }

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments, editingMode],
  );

  /* ============================================================
   * Cascade OKR → Structured KR 生成
   * - 進化/探索を KR 側に自動付与（推定 or project.track）
   * ========================================================== */
  const generateKRFromCascade = useCallback(
    (dIdx: number, pIdx: number, okrSource: OKR[]) => {
      if (!okrSource || okrSource.length === 0) {
        alert('このプロジェクトには、カスケードで生成されたOKRがありません。');
        return;
      }

      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const proj = { ...projPrev };

        const addInto = (existing: KRStructuredX[]) => {
          let changed = false;
          okrSource.forEach((o) => {
            const ownerHint = o.owner;
            const krs = ensureArray(o.keyResults as string[] | undefined);

            krs.forEach((krText) => {
              const label = (krText ?? '').trim();
              if (!label) return;

              const already = existing.some((x) => String(x.label ?? '').trim() === label);
              if (already) return;

              const kr = buildKRFromText(label, ownerHint, {
                scope: 'project',
                track: (proj.track ?? 'EVOLVE') as any,
              });

              // project/departmentの意図を引き継ぐ（非破壊）
              const enriched = mkKRStructured({
                ...(kr as KRStructuredX),
                track: (kr as any).track ?? proj.track,
                validation:
                  ((kr as any).track ?? proj.track) === 'EXPLORE'
                    ? ((kr as any).validation ?? { status: 'not_started', hypothesis: '', testMethod: '', evidence: '', nextAction: '' })
                    : (kr as any).validation,
              });

              existing.push(enriched);
              changed = true;
            });
          });
          return { changed, existing };
        };

        if (editingMode === 'committed') {
          const existing: KRStructuredX[] = Array.isArray(proj.okrsV2) ? [...(proj.okrsV2 as KRStructuredX[])] : [];
          const { changed, existing: merged } = addInto(existing);
          if (!changed) return prev;
          (proj as any).okrsV2 = merged;
        } else {
          const vid = proj.activeVariantId;
          if (!vid) return prev;

          const variants = ensureArray(proj.okrVariants).map((v) => {
            if (v.id !== vid) return v;

            const existing: KRStructuredX[] = Array.isArray(v.okrsV2) ? [...(v.okrsV2 as KRStructuredX[])] : [];
            const { changed, existing: merged } = addInto(existing);
            if (!changed) return v;

            // variant.track を KR にも反映（非破壊）
            const merged2 = merged.map((k) =>
              mkKRStructured({
                ...(k as KRStructuredX),
                track: (k as any).track ?? v.track ?? proj.track,
                validation:
                  ((k as any).track ?? v.track ?? proj.track) === 'EXPLORE'
                    ? ((k as any).validation ?? {
                        status: 'not_started',
                        hypothesis: '',
                        testMethod: '',
                        evidence: '',
                        nextAction: '',
                      })
                    : (k as any).validation,
              }),
            );

            return { ...v, okrsV2: merged2 };
          });

          (proj as any).okrVariants = variants;
        }

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });

      alert('カスケードOKRから、構造化KRのたたき台を追加しました。');
    },
    [patchDepartments, editingMode],
  );

  /* ============================================================
   * 追加：Projectの戦略メタ（track/levers）を更新したい場合に備える
   * - page.tsx 側UI実装で使える
   * ========================================================== */
  const updateProjectStrategicMeta = useCallback(
    (
      dIdx: number,
      pIdx: number,
      patch: Partial<Pick<Project, 'track' | 'levers' | 'winPatternPrimary' | 'winPatternSecondary'>>,
      options?: { cascadeToKrs?: boolean },
    ) => {
      patchDepartments((prev) => {
        const next = [...prev];
        const deptPrev = next[dIdx];
        if (!deptPrev) return prev;

        const dept = { ...deptPrev };
        const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
        const projPrev = projs[pIdx];
        if (!projPrev) return prev;

        const proj: Project = { ...projPrev, ...patch };

        // 任意：project.track を committed KR にも波及（非破壊）
        if (options?.cascadeToKrs && proj.track) {
          const okrsV2 = Array.isArray(proj.okrsV2) ? [...(proj.okrsV2 as KRStructuredX[])] : [];
          const nextKrs = okrsV2.map((k) => ({ ...(k as KRStructuredX), track: (k as KRStructuredX).track ?? proj.track }));
          proj.okrsV2 = nextKrs;
        }

        projs[pIdx] = proj;
        dept.projects = projs;
        next[dIdx] = dept;
        return next;
      });
    },
    [patchDepartments],
  );

  return {
    patchDepartments,

    updateProjectRole,
    updateProjectRoleDetail,
    updateProjectOKR,

    // 追加：戦略メタ更新
    updateProjectStrategicMeta,

    setActiveVariant,
    createVariantFromCommitted,
    deleteVariant,
    renameVariant,
    setVariantStatus,
    adoptVariantToCommitted,

    updateStructuredKR,
    deleteStructuredKR,

    generateKRFromCascade,
    addStructuredKR,
  };
}
