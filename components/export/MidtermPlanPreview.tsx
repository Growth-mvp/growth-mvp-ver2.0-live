/**
 * /components/export/MidtermPlanPreview.tsx
 *
 * 中計戦略書プレビュー：6章構成の読み取り専用表示
 * STAGE1〜4のデータを統合して表示
 */

import type { MidtermPlanData } from '@/utils/export/buildMidtermPlanData';

export interface MidtermPlanPreviewProps {
  data: MidtermPlanData;
}

/**
 * 中計戦略書プレビューコンポーネント
 */
export function MidtermPlanPreview({ data }: MidtermPlanPreviewProps) {
  const hasStage2 = !!(
    data.stage2.finalStory ||
    data.stage2.midtermConcept ||
    data.stage2.priorityThemes?.length
  );
  const hasStage3 = data.stage3.departments.length > 0;
  const hasStage4 = data.stage4.departmentKpis?.some((d) => d.kpis?.length);

  return (
    <div className="space-y-8">
      {/* 表紙 */}
      <div className="bg-gradient-to-b from-blue-600 to-blue-800 text-white rounded-lg p-12 text-center">
        <h1 className="text-4xl font-bold mb-2">中期経営計画</h1>
        <p className="text-blue-100">戦略書プレビュー</p>
        <p className="text-sm text-blue-200 mt-4">
          {data.companyName || '（会社名未設定）'}
        </p>
      </div>

      {/* 第1章：全社戦略の方向性 */}
      <div className="break-inside-avoid page-break">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-600">
          1. 全社戦略の方向性
        </h2>
        {hasStage2 ? (
          <div className="space-y-4">
            {data.stage2.midtermConcept && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">中計の基本コンセプト</h3>
                <p className="text-gray-700">{data.stage2.midtermConcept}</p>
              </div>
            )}
            {data.stage2.targetVision && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">目指す姿</h3>
                <p className="text-gray-700">{data.stage2.targetVision}</p>
              </div>
            )}
            {data.stage2.priorityThemes?.length ? (
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">重点戦略テーマ</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {data.stage2.priorityThemes.map((theme, i) => (
                    <li key={i} className="text-gray-700">
                      {theme}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.stage2.finalStory && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">経営戦略ストーリー</h3>
                <p className="text-gray-700 whitespace-pre-wrap text-sm">{data.stage2.finalStory.slice(0, 500)}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500 italic">STAGE2の全社戦略・中計設計がまだ生成されていません。</p>
        )}
      </div>

      {/* 第2章：事業・部門ごとの中計上の役割 */}
      <div className="break-inside-avoid page-break">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-600">
          2. 事業・部門ごとの中計上の役割
        </h2>
        {hasStage3 ? (
          <div className="space-y-4">
            {data.stage3.departments.map((dept, i) => (
              <div key={i} className="border-l-4 border-blue-300 pl-4">
                <h3 className="font-semibold text-gray-800">{dept.name}</h3>
                {dept.currentPosition && (
                  <p className="text-sm text-gray-700 mt-1">
                    <span className="font-medium">現在の位置づけ：</span> {dept.currentPosition}
                  </p>
                )}
                {dept.strategicRole && (
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">中計上の役割：</span> {dept.strategicRole}
                  </p>
                )}
                {dept.keyIssues?.length ? (
                  <div className="text-sm text-gray-700 mt-1">
                    <span className="font-medium">主要課題：</span>
                    <ul className="list-disc pl-5 mt-1">
                      {dept.keyIssues.map((issue, j) => (
                        <li key={j}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">STAGE3の事業・部門別戦略がまだ生成されていません。</p>
        )}
      </div>

      {/* 第3章：事業・部門別の重点戦略 */}
      <div className="break-inside-avoid page-break">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-600">
          3. 事業・部門別の重点戦略
        </h2>
        {hasStage3 ? (
          <div className="space-y-4">
            {data.stage3.departments.map((dept, i) => (
              <div key={i} className="border-l-4 border-blue-300 pl-4">
                <h3 className="font-semibold text-gray-800 mb-2">{dept.name}</h3>
                {dept.projects?.length ? (
                  <div className="text-sm">
                    <span className="font-medium text-gray-700">重点施策：</span>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">
                      {dept.projects.map((proj, j) => (
                        <li key={j} className="text-gray-700">
                          {proj}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {dept.riskNotes?.length ? (
                  <div className="text-sm mt-2">
                    <span className="font-medium text-gray-700">実行リスク：</span>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">
                      {dept.riskNotes.map((risk, j) => (
                        <li key={j} className="text-gray-600">
                          {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">STAGE3の事業・部門別戦略がまだ生成されていません。</p>
        )}
      </div>

      {/* 第4章：横断機能・連携論点 */}
      <div className="break-inside-avoid page-break">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-600">
          4. 横断機能・連携論点
        </h2>
        {hasStage3 && data.stage3.departments.some((d) => d.interDeptCollab?.length) ? (
          <div className="space-y-3">
            {data.stage3.departments
              .filter((d) => d.interDeptCollab?.length)
              .map((dept, i) => (
                <div key={i} className="border-l-4 border-purple-300 pl-4">
                  <h3 className="font-semibold text-gray-800 text-sm">{dept.name}</h3>
                  <ul className="list-disc pl-5 mt-1 text-sm space-y-0.5">
                    {dept.interDeptCollab?.map((collab, j) => (
                      <li key={j} className="text-gray-700">
                        {collab}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">事業部間連携がまだ定義されていません。</p>
        )}
      </div>

      {/* 第5章：KPI体系のたたき台 */}
      <div className="break-inside-avoid page-break">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-600">
          5. KPI体系のたたき台
        </h2>
        {hasStage4 ? (
          <div className="space-y-4">
            {data.stage4.companyThemes?.length ? (
              <div>
                <h3 className="font-semibold text-gray-800 mb-2">全社重点テーマ</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {data.stage4.companyThemes.map((theme, i) => (
                    <li key={i} className="text-gray-700">
                      {theme}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.stage4.departmentKpis?.some((d) => d.kpis?.length) ? (
              <div>
                <h3 className="font-semibold text-gray-800 mb-2">事業・部門別KPI候補</h3>
                <div className="space-y-3">
                  {data.stage4.departmentKpis
                    .filter((d) => d.kpis?.length)
                    .map((dept, i) => (
                      <div key={i} className="border-l-4 border-green-300 pl-4">
                        <h4 className="font-medium text-gray-800 text-sm">{dept.departmentName}</h4>
                        <ul className="list-disc pl-5 mt-1 text-sm space-y-0.5">
                          {dept.kpis?.map((kpi, j) => (
                            <li key={j} className="text-gray-700">
                              {kpi}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-gray-500 italic">STAGE4のKPI体系がまだ十分に整理されていません。</p>
        )}
      </div>

      {/* 第6章：経営会議で確認すべき論点 */}
      <div className="break-inside-avoid page-break">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b-2 border-blue-600">
          6. 経営会議で確認すべき論点
        </h2>
        {data.stage2.managementIssues?.length || data.stage3.departments.some((d) => d.alignmentRisks?.length) ? (
          <div className="space-y-4">
            {data.stage2.managementIssues?.length ? (
              <div>
                <h3 className="font-semibold text-gray-800 mb-2">全社レベルの論点</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {data.stage2.managementIssues.map((issue, i) => (
                    <li key={i} className="text-gray-700">
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.stage3.departments.some((d) => d.alignmentRisks?.length) && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-2">認識のズレが起きやすいポイント</h3>
                <div className="space-y-2">
                  {data.stage3.departments
                    .filter((d) => d.alignmentRisks?.length)
                    .map((dept, i) => (
                      <div key={i} className="text-sm border-l-4 border-red-300 pl-4">
                        <span className="font-medium text-gray-800">{dept.name}：</span>
                        <ul className="list-disc pl-5 mt-1">
                          {dept.alignmentRisks?.map((risk, j) => (
                            <li key={j} className="text-gray-700">
                              {risk}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500 italic">経営会議での確認論点がまだ定義されていません。</p>
        )}
      </div>
    </div>
  );
}
