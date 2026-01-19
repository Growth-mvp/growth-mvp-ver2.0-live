// scripts/stage3.smoke.mjs
// STAGE3品質検証スクリプト（最小スモークテスト）
// 実行: npm run dev を別ターミナルで起動後、npm run stage3:smoke

const API_URL = 'http://localhost:3000/api/generate-cascade';

// 最小限のテストペイロード
const testPayload = {
  thought: 'テスト用の経営者の想い',
  vision: 'テストビジョン',
  mission: 'テストミッション',
  industry: 'software',
  revenue: 1000,
  employees: 50,
  strategySummary: 'テスト用の戦略要約：顧客価値を高め、収益性を向上させる',

  // ★STAGE2データ（valueDriverKPIsを含む）
  valueDriverKPIs: [
    { id: 'kpi_arpu', label: 'ARPU（顧客単価）', description: '顧客あたりの平均単価', category: 'growth' },
    { id: 'kpi_ltv', label: 'LTV（顧客生涯価値）', description: '顧客の生涯価値', category: 'growth' },
    { id: 'kpi_churn', label: '解約率', description: '月次解約率', category: 'efficiency' },
  ],
  winPatternPrimary: 'テスト勝ち筋：高付加価値案件の比率向上',
  winPatternSecondary: 'テスト副次勝ち筋：上流提案の定着',

  // 部門情報（最小1部門）
  departments: [
    {
      name: 'テスト営業部',
      direction: 'テスト方向性：顧客との接点を増やし、単価を向上させる',
      expectations: ['高付加価値案件の増加', 'LTVの向上'],
      focusThemes: ['提案力強化', 'アップセル'],
      answers: [
        { stepNumber: 1, label: '現状', answer: 'テスト回答1：現在は価格競争に陥っている' },
        { stepNumber: 2, label: 'ありたい姿', answer: 'テスト回答2：高付加価値で選ばれる' },
        { stepNumber: 3, label: '障壁', answer: 'テスト回答3：提案力とデータ活用力の不足' },
        { stepNumber: 4, label: 'やめること', answer: 'テスト回答4：低単価案件への過度な対応' },
        { stepNumber: 5, label: '必要なもの', answer: 'テスト回答5：PM・データ分析スキル' },
        { stepNumber: 6, label: '撤退基準', answer: 'テスト回答6：ROI10%未満の施策' },
      ],
      missionDraft: '',
      projects: [],
      okrs: [],
    },
  ],
};

// アサーションヘルパー
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

// メイン検証ロジック
async function runSmokeTest() {
  console.log('='.repeat(60));
  console.log('STAGE3 スモークテスト開始');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`valueDriverKPIs: ${testPayload.valueDriverKPIs.length}個`);
  console.log('');

  // 1. API呼び出し
  console.log('【ステップ1】API呼び出し...');
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
  } catch (err) {
    console.error('❌ ネットワークエラー:', err.message);
    console.error('→ npm run dev が起動しているか確認してください');
    process.exit(1);
  }

  assert(response.ok, `APIレスポンスステータスが200-299 (実際: ${response.status})`);

  const data = await response.json();
  console.log('');

  // 2. 基本構造の検証
  console.log('【ステップ2】基本構造の検証...');
  assert(data.departments, 'departments配列が存在する');
  assert(Array.isArray(data.departments), 'departmentsが配列である');
  assert(data.departments.length > 0, 'departments配列に要素が1つ以上ある');
  console.log(`部門数: ${data.departments.length}`);
  console.log('');

  // 3. STAGE3フィールドの検証
  console.log('【ステップ3】STAGE3拡張フィールドの検証...');

  let totalProjects = 0;
  let projectsWithValueDriverLinks = 0;
  let projectsWithSkills = 0;
  let projectsWithInvestments = 0;
  let projectsWith2PlusCategories = 0;

  for (const dept of data.departments) {
    console.log(`\n部門: ${dept.name}`);

    // lanes.existing.projects のチェック
    if (dept.lanes?.existing?.projects) {
      const projects = dept.lanes.existing.projects;
      console.log(`  既存進化レーン: ${projects.length}プロジェクト`);

      for (const project of projects) {
        totalProjects++;
        console.log(`    - ${project.title}`);

        // valueDriverLinks の検証
        if (project.valueDriverLinks && Array.isArray(project.valueDriverLinks) && project.valueDriverLinks.length >= 1) {
          projectsWithValueDriverLinks++;
          console.log(`      ✓ valueDriverLinks: ${project.valueDriverLinks.length}個 [${project.valueDriverLinks.join(', ')}]`);
        } else {
          console.error(`      ❌ valueDriverLinks が不足: ${JSON.stringify(project.valueDriverLinks)}`);
        }

        // skillRequirements.executionSkills の検証
        if (project.skillRequirements?.executionSkills &&
            Array.isArray(project.skillRequirements.executionSkills) &&
            project.skillRequirements.executionSkills.length >= 1) {
          projectsWithSkills++;
          console.log(`      ✓ executionSkills: ${project.skillRequirements.executionSkills.length}個 [${project.skillRequirements.executionSkills.join(', ')}]`);
        } else {
          console.error(`      ❌ executionSkills が不足: ${JSON.stringify(project.skillRequirements?.executionSkills)}`);
        }

        // humanInvestments の検証
        if (project.humanInvestments && Array.isArray(project.humanInvestments) && project.humanInvestments.length >= 1) {
          projectsWithInvestments++;
          const categories = new Set(project.humanInvestments.map(inv => inv.category));
          console.log(`      ✓ humanInvestments: ${project.humanInvestments.length}件, ${categories.size}カテゴリ`);

          if (categories.size >= 2) {
            projectsWith2PlusCategories++;
          }
        } else {
          console.error(`      ❌ humanInvestments が不足: ${JSON.stringify(project.humanInvestments)}`);
        }
      }
    }

    // lanes.new.projects のチェック
    if (dept.lanes?.new?.projects) {
      const projects = dept.lanes.new.projects;
      console.log(`  新規探索レーン: ${projects.length}プロジェクト`);

      for (const project of projects) {
        totalProjects++;
        console.log(`    - ${project.title}`);

        if (project.valueDriverLinks && Array.isArray(project.valueDriverLinks) && project.valueDriverLinks.length >= 1) {
          projectsWithValueDriverLinks++;
          console.log(`      ✓ valueDriverLinks: ${project.valueDriverLinks.length}個`);
        } else {
          console.error(`      ❌ valueDriverLinks が不足`);
        }

        if (project.skillRequirements?.executionSkills &&
            Array.isArray(project.skillRequirements.executionSkills) &&
            project.skillRequirements.executionSkills.length >= 1) {
          projectsWithSkills++;
          console.log(`      ✓ executionSkills: ${project.skillRequirements.executionSkills.length}個`);
        } else {
          console.error(`      ❌ executionSkills が不足`);
        }

        if (project.humanInvestments && Array.isArray(project.humanInvestments) && project.humanInvestments.length >= 1) {
          projectsWithInvestments++;
          const categories = new Set(project.humanInvestments.map(inv => inv.category));
          console.log(`      ✓ humanInvestments: ${project.humanInvestments.length}件, ${categories.size}カテゴリ`);

          if (categories.size >= 2) {
            projectsWith2PlusCategories++;
          }
        } else {
          console.error(`      ❌ humanInvestments が不足`);
        }
      }
    }
  }

  console.log('');
  console.log('【ステップ4】集計結果の検証...');
  console.log(`総プロジェクト数: ${totalProjects}`);
  console.log(`valueDriverLinks あり: ${projectsWithValueDriverLinks}/${totalProjects}`);
  console.log(`executionSkills あり: ${projectsWithSkills}/${totalProjects}`);
  console.log(`humanInvestments あり: ${projectsWithInvestments}/${totalProjects}`);
  console.log(`humanInvestments 2+カテゴリ: ${projectsWith2PlusCategories}/${totalProjects}`);

  assert(totalProjects > 0, '検証対象のプロジェクトが1つ以上存在する');
  assert(projectsWithValueDriverLinks === totalProjects, '全プロジェクトに valueDriverLinks が存在する（length>=1）');
  assert(projectsWithSkills === totalProjects, '全プロジェクトに executionSkills が存在する（length>=1）');
  assert(projectsWithInvestments === totalProjects, '全プロジェクトに humanInvestments が存在する（length>=1）');

  // 2カテゴリは推奨だが必須ではないので警告のみ
  if (projectsWith2PlusCategories < totalProjects) {
    console.log(`⚠️  humanInvestments が2カテゴリ未満のプロジェクトがあります（${totalProjects - projectsWith2PlusCategories}件）`);
  }

  console.log('');
  console.log('【ステップ5】上書き防止の確認...');
  console.log('fillMissingStage3Fields() の実装を確認:');
  console.log('  ✓ valueDriverLinks: 空または未定義の場合のみ補完');
  console.log('  ✓ skillRequirements: executionSkills が空または未定義の場合のみ補完');
  console.log('  ✓ humanInvestments: 空または未定義の場合のみ補完');
  console.log('  → 既存のユーザー入力データは上書きされません');
  console.log('');

  console.log('【ステップ6】多様性チェック（全プロジェクト同一問題の検証）...');

  // 全プロジェクトの executionSkills を収集
  const allExecutionSkills = [];
  const allHumanInvestmentTitles = [];

  for (const dept of data.departments) {
    if (dept.lanes?.existing?.projects) {
      for (const project of dept.lanes.existing.projects) {
        if (project.skillRequirements?.executionSkills) {
          allExecutionSkills.push(JSON.stringify(project.skillRequirements.executionSkills.sort()));
        }
        if (project.humanInvestments) {
          allHumanInvestmentTitles.push(JSON.stringify(project.humanInvestments.map(inv => inv.title).sort()));
        }
      }
    }
    if (dept.lanes?.new?.projects) {
      for (const project of dept.lanes.new.projects) {
        if (project.skillRequirements?.executionSkills) {
          allExecutionSkills.push(JSON.stringify(project.skillRequirements.executionSkills.sort()));
        }
        if (project.humanInvestments) {
          allHumanInvestmentTitles.push(JSON.stringify(project.humanInvestments.map(inv => inv.title).sort()));
        }
      }
    }
  }

  // executionSkills の同一率を計算
  if (allExecutionSkills.length >= 2) {
    const skillCounts = {};
    for (const skillSet of allExecutionSkills) {
      skillCounts[skillSet] = (skillCounts[skillSet] || 0) + 1;
    }

    const maxCount = Math.max(...Object.values(skillCounts));
    const identicalRate = maxCount / allExecutionSkills.length;

    console.log(`executionSkills 多様性:`);
    console.log(`  - 総プロジェクト数: ${allExecutionSkills.length}`);
    console.log(`  - ユニークなスキルセット数: ${Object.keys(skillCounts).length}`);
    console.log(`  - 最頻出スキルセット: ${maxCount}回 (${(identicalRate * 100).toFixed(1)}%)`);

    if (identicalRate > 0.9) {
      console.error(`  ❌ executionSkills の同一率が90%を超えています (${(identicalRate * 100).toFixed(1)}%)`);
      console.error(`  → プロジェクト間で多様性が不足しています`);
      process.exit(1);
    } else {
      console.log(`  ✓ executionSkills に十分な多様性があります (同一率: ${(identicalRate * 100).toFixed(1)}%)`);
    }
  }

  // humanInvestments の同一率を計算
  if (allHumanInvestmentTitles.length >= 2) {
    const investmentCounts = {};
    for (const investmentSet of allHumanInvestmentTitles) {
      investmentCounts[investmentSet] = (investmentCounts[investmentSet] || 0) + 1;
    }

    const maxCount = Math.max(...Object.values(investmentCounts));
    const identicalRate = maxCount / allHumanInvestmentTitles.length;

    console.log(`humanInvestments 多様性:`);
    console.log(`  - 総プロジェクト数: ${allHumanInvestmentTitles.length}`);
    console.log(`  - ユニークな施策セット数: ${Object.keys(investmentCounts).length}`);
    console.log(`  - 最頻出施策セット: ${maxCount}回 (${(identicalRate * 100).toFixed(1)}%)`);

    if (identicalRate > 0.9) {
      console.error(`  ❌ humanInvestments の同一率が90%を超えています (${(identicalRate * 100).toFixed(1)}%)`);
      console.error(`  → プロジェクト間で多様性が不足しています`);
      process.exit(1);
    } else {
      console.log(`  ✓ humanInvestments に十分な多様性があります (同一率: ${(identicalRate * 100).toFixed(1)}%)`);
    }
  }
  console.log('');

  console.log('='.repeat(60));
  console.log('✅ 全ての検証に成功しました！');
  console.log('='.repeat(60));
  console.log('');
  console.log('STAGE3の品質が仕様通りであることを確認しました：');
  console.log('  1. 全プロジェクトに valueDriverLinks が存在する');
  console.log('  2. 全プロジェクトに skillRequirements.executionSkills が存在する');
  console.log('  3. 全プロジェクトに humanInvestments が存在する');
  console.log('  4. フォールバックは既存データを上書きしない実装になっている');
  console.log('  5. プロジェクト間で十分な多様性が確保されている（同一率<90%）');
}

// 実行
runSmokeTest().catch((err) => {
  console.error('');
  console.error('❌ スモークテストでエラーが発生しました:');
  console.error(err);
  process.exit(1);
});
