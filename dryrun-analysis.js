const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://yuerkbxpivdhaikrnsar.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1ZXJrYnhwaXZkaGFpa3Juc2FyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTY4NTIyMCwiZXhwIjoyMDY3MjYxMjIwfQ.I5aHqMP9T71YimXX-UQIZy0kghxsLIcncAiSsBF0tlI'
);

(async () => {
  try {
    // Get all strategies with departments
    const { data: strategies } = await supabase
      .from('strategy_data')
      .select('id, departments');

    console.log('=== ACTUAL DRY-RUN RESULTS ===\n');

    let totalDepts = 0;
    let totalProjects = 0;
    let totalOkrs = 0;
    let okrsWithObjective = 0;

    for (const strategy of strategies) {
      const depts = strategy.departments || [];
      totalDepts += depts.length;

      for (const dept of depts) {
        // Check structure: lanes vs direct projects
        let projects = [];

        if (dept.lanes) {
          // New structure with lanes
          const newProjects = dept.lanes.new?.projects || [];
          const existingProjects = dept.lanes.existing?.projects || [];
          projects = [...newProjects, ...existingProjects];
        } else if (dept.projects) {
          // Direct projects
          projects = dept.projects;
        }

        totalProjects += projects.length;

        for (const proj of projects) {
          const okrs = proj.okrs || [];
          totalOkrs += okrs.length;

          for (const okr of okrs) {
            if (okr.objective && okr.objective.trim()) {
              okrsWithObjective++;
            }
          }
        }
      }
    }

    console.log('Data Summary:');
    console.log('  Strategies:', strategies.length);
    console.log('  Total Departments:', totalDepts);
    console.log('  Total Projects:', totalProjects);
    console.log('  Total OKRs in strategy_data:', totalOkrs);
    console.log('  OKRs with valid objectives:', okrsWithObjective);
    console.log('');

    // Check sample department
    console.log('=== SAMPLE DATA STRUCTURE ===\n');
    const firstStrategy = strategies[0];
    if (firstStrategy && firstStrategy.departments.length > 0) {
      const deptSample = firstStrategy.departments[0];
      console.log('Department structure:');
      console.log('  - Has id:', !!deptSample.id);
      console.log('  - Has name:', !!deptSample.name);
      console.log('  - Has lanes:', !!deptSample.lanes);

      if (deptSample.lanes) {
        console.log('\nLanes structure:');
        const newCount = deptSample.lanes.new?.projects?.length || 0;
        const existCount = deptSample.lanes.existing?.projects?.length || 0;
        console.log('  - new.projects:', newCount);
        console.log('  - existing.projects:', existCount);

        const projSample = deptSample.lanes.new?.projects?.[0] || deptSample.lanes.existing?.projects?.[0];
        if (projSample) {
          console.log('\nProject structure:');
          console.log('  - Has id:', !!projSample.id);
          console.log('  - Has title:', !!projSample.title);
          console.log('  - OKRs array:', Array.isArray(projSample.okrs));
        }
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
