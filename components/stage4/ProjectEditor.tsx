// components/stage4/ProjectEditor.tsx
import React, { useState } from 'react';
import { PlusCircle, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { Stage4Current, HumanInvestment, SkillRequirements } from '@/types/strategy';

type ProjectEditorProps = {
  current: Stage4Current;
  onChange: (updated: Stage4Current) => void;
  disabled?: boolean;
};

export function ProjectEditor({ current, onChange, disabled }: ProjectEditorProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleProject = (title: string) => {
    const next = new Set(expandedProjects);
    if (next.has(title)) {
      next.delete(title);
    } else {
      next.add(title);
    }
    setExpandedProjects(next);
  };

  const updateProject = (index: number, updates: Partial<Stage4Current['projects'][0]>) => {
    const updated = {
      ...current,
      projects: current.projects.map((p, i) => (i === index ? { ...p, ...updates } : p)),
    };
    // ★ KPI削除時の詳細ログ
    if ('kpiTargets' in updates) {
      console.log('[diag][stage4:kpi-delete:updateProject]', {
        projectIndex: index,
        projectTitle: current.projects[index]?.title,
        kpiTargetsBefore: Object.keys(current.projects[index]?.kpiTargets || {}).length,
        kpiTargetsAfter: Object.keys((updates as any).kpiTargets || {}).length,
        updateKeys: Object.keys((updates as any).kpiTargets || {}),
      });
    }
    onChange(updated);
  };

  const addKpiTarget = (projectIndex: number) => {
    const proj = current.projects[projectIndex];
    const kpiTargets = { ...(proj.kpiTargets || {}), [`新規KPI${Object.keys(proj.kpiTargets || {}).length + 1}`]: 0 };
    updateProject(projectIndex, { kpiTargets });
  };

  const updateKpiTarget = (projectIndex: number, oldKey: string, newKey: string, value: number) => {
    const proj = current.projects[projectIndex];
    const kpiTargets = { ...(proj.kpiTargets || {}) };
    delete kpiTargets[oldKey];
    kpiTargets[newKey] = value;
    updateProject(projectIndex, { kpiTargets });
  };

  const deleteKpiTarget = (projectIndex: number, key: string) => {
    // ★ 診断: 関数に到達した確認
    console.log('[FUNCTION_ENTRY] deleteKpiTarget called', {
      projectIndex,
      kpiKey: key,
      currentProjectCount: current.projects.length,
      timestamp: new Date().toISOString(),
    });

    const proj = current.projects[projectIndex];
    if (!proj) {
      console.warn('[diag][stage4:kpi-delete:not-found:project]', { projectIndex, availableIndexes: current.projects.map((_, i) => i) });
      return;
    }

    const kpiTargets = { ...(proj.kpiTargets || {}) };
    const renderKpiKeys = Object.keys(kpiTargets);

    // ★ DIAG: KPI削除前の状態
    console.log('[diag][stage4:kpi-delete:before]', {
      projectIndex,
      projectTitle: proj.title,
      kpiKey: key,
      renderKpiKeys,
      kpiCountBefore: renderKpiKeys.length,
      isKeyInKpiTargets: key in kpiTargets,
    });

    if (!(key in kpiTargets)) {
      // ★ Silent return 防止：key が見つからない
      console.warn('[diag][stage4:kpi-delete:not-found:key]', {
        projectIndex,
        projectTitle: proj.title,
        requestedKey: key,
        availableKeys: renderKpiKeys,
      });
      return;
    }

    delete kpiTargets[key];

    // ★ DIAG: KPI削除直後の状態
    console.log('[diag][stage4:kpi-delete:after]', {
      projectIndex,
      projectTitle: proj.title,
      kpiKey: key,
      kpiCountAfter: Object.keys(kpiTargets).length,
      kpiTargetsSnapshot: kpiTargets,
    });

    updateProject(projectIndex, { kpiTargets });
  };

  const addSkill = (projectIndex: number, type: 'roleSkills' | 'executionSkills') => {
    const proj = current.projects[projectIndex];
    const skills = proj.skillRequirements || { roleSkills: [], executionSkills: [] };
    const updated: SkillRequirements = {
      ...skills,
      [type]: [...(skills[type] || []), '新規スキル'],
    };
    updateProject(projectIndex, { skillRequirements: updated });
  };

  const updateSkill = (projectIndex: number, type: 'roleSkills' | 'executionSkills', skillIndex: number, value: string) => {
    const proj = current.projects[projectIndex];
    const skills = proj.skillRequirements || { roleSkills: [], executionSkills: [] };
    const updated: SkillRequirements = {
      ...skills,
      [type]: (skills[type] || []).map((s, i) => (i === skillIndex ? value : s)),
    };
    updateProject(projectIndex, { skillRequirements: updated });
  };

  const deleteSkill = (projectIndex: number, type: 'roleSkills' | 'executionSkills', skillIndex: number) => {
    const proj = current.projects[projectIndex];
    const skills = proj.skillRequirements || { roleSkills: [], executionSkills: [] };
    const updated: SkillRequirements = {
      ...skills,
      [type]: (skills[type] || []).filter((_, i) => i !== skillIndex),
    };
    updateProject(projectIndex, { skillRequirements: updated });
  };

  const addInvestment = (projectIndex: number) => {
    const proj = current.projects[projectIndex];
    const newInv: HumanInvestment = {
      title: '新規投資',
      category: 'HIRING',
      horizon: '0_3M',
    };
    updateProject(projectIndex, { humanInvestments: [...(proj.humanInvestments || []), newInv] });
  };

  const updateInvestment = (projectIndex: number, invIndex: number, updates: Partial<HumanInvestment>) => {
    const proj = current.projects[projectIndex];
    const investments = (proj.humanInvestments || []).map((inv, i) => (i === invIndex ? { ...inv, ...updates } : inv));
    updateProject(projectIndex, { humanInvestments: investments });
  };

  const deleteInvestment = (projectIndex: number, invIndex: number) => {
    const proj = current.projects[projectIndex];
    const investments = (proj.humanInvestments || []).filter((_, i) => i !== invIndex);
    updateProject(projectIndex, { humanInvestments: investments });
  };

  return (
    <div className="space-y-4">
      {current.projects.map((proj, pIdx) => {
        const isExpanded = expandedProjects.has(proj.title);

        return (
          <div key={pIdx} className="border border-gray-200 rounded-lg">
            {/* プロジェクトヘッダー */}
            <button
              onClick={() => toggleProject(proj.title)}
              disabled={disabled}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <h4 className="font-medium text-gray-900">{proj.title}</h4>
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>

            {isExpanded && (
              <div className="p-4 border-t border-gray-200 space-y-6">
                {/* KPIターゲット */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-medium text-gray-700">KPIターゲット</h5>
                    <button
                      onClick={() => addKpiTarget(pIdx)}
                      disabled={disabled}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      追加
                    </button>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(proj.kpiTargets || {}).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={key}
                          onChange={(e) => updateKpiTarget(pIdx, key, e.target.value, value)}
                          disabled={disabled}
                          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                          placeholder="KPI名"
                        />
                        <input
                          type="number"
                          value={value}
                          onChange={(e) => updateKpiTarget(pIdx, key, key, parseFloat(e.target.value) || 0)}
                          disabled={disabled}
                          className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                          placeholder="目標"
                        />
                        <button
                          onClick={() => {
                            console.log('KPI_DELETE_CLICKED', { projectIndex: pIdx, kpiKey: key, timestamp: new Date().toISOString() });
                            deleteKpiTarget(pIdx, key);
                          }}
                          disabled={disabled}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* スキル要件 */}
                <div>
                  <h5 className="text-sm font-medium text-gray-700 mb-3">スキル要件</h5>
                  <div className="space-y-4">
                    {/* ロールスキル */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-600">ロールスキル</span>
                        <button
                          onClick={() => addSkill(pIdx, 'roleSkills')}
                          disabled={disabled}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          追加
                        </button>
                      </div>
                      <div className="space-y-1">
                        {(proj.skillRequirements?.roleSkills || []).map((skill, sIdx) => (
                          <div key={sIdx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={skill}
                              onChange={(e) => updateSkill(pIdx, 'roleSkills', sIdx, e.target.value)}
                              disabled={disabled}
                              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            />
                            <button
                              onClick={() => deleteSkill(pIdx, 'roleSkills', sIdx)}
                              disabled={disabled}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 実行スキル */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-600">実行スキル</span>
                        <button
                          onClick={() => addSkill(pIdx, 'executionSkills')}
                          disabled={disabled}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          追加
                        </button>
                      </div>
                      <div className="space-y-1">
                        {(proj.skillRequirements?.executionSkills || []).map((skill, sIdx) => (
                          <div key={sIdx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={skill}
                              onChange={(e) => updateSkill(pIdx, 'executionSkills', sIdx, e.target.value)}
                              disabled={disabled}
                              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            />
                            <button
                              onClick={() => deleteSkill(pIdx, 'executionSkills', sIdx)}
                              disabled={disabled}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 人的投資 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-medium text-gray-700">人的投資</h5>
                    <button
                      onClick={() => addInvestment(pIdx)}
                      disabled={disabled}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      追加
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(proj.humanInvestments || []).map((inv, iIdx) => (
                      <div key={iIdx} className="flex items-start gap-2 p-2 border border-gray-200 rounded">
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={inv.title}
                            onChange={(e) => updateInvestment(pIdx, iIdx, { title: e.target.value })}
                            disabled={disabled}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            placeholder="投資タイトル"
                          />
                          <div className="flex gap-2">
                            <select
                              value={inv.category}
                              onChange={(e) => updateInvestment(pIdx, iIdx, { category: e.target.value as HumanInvestment['category'] })}
                              disabled={disabled}
                              className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            >
                              <option value="HIRING">採用</option>
                              <option value="TRAINING_OJT">研修・OJT</option>
                              <option value="EXTERNAL">外部活用</option>
                              <option value="ALLOCATION">配置・異動</option>
                              <option value="TOOLS_PROCESS">ツール・仕組み</option>
                            </select>
                            <select
                              value={inv.horizon || ''}
                              onChange={(e) => updateInvestment(pIdx, iIdx, { horizon: e.target.value as HumanInvestment['horizon'] })}
                              disabled={disabled}
                              className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            >
                              <option value="">未設定</option>
                              <option value="0_3M">0〜3ヶ月</option>
                              <option value="3_6M">3〜6ヶ月</option>
                              <option value="6_12M">6〜12ヶ月</option>
                            </select>
                          </div>
                        </div>
                        <button
                          onClick={() => deleteInvestment(pIdx, iIdx)}
                          disabled={disabled}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
