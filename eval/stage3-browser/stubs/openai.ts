/* 検証用のAI：実際のOpenAIは呼ばない。入力に書かれた部門ID・計画IDから、決まった形の応答を作る。 */
type Msg = { role: string; content: string };
type Unit = { dept: string; id: string; title: string };

function parseUnits(text: string) {
  const depts: Array<{ key: string; name: string }> = [];
  const plans: Unit[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const d = /【部門 部門ID=(\S+) 名称=([^】]+)】/.exec(line);
    if (d) {
      current = d[1];
      depts.push({ key: d[1], name: d[2] });
      continue;
    }
    const p = /計画ID=(\S+): (.+)$/.exec(line);
    if (p && current) plans.push({ dept: current, id: p[1], title: p[2] });
  }
  return { depts, plans };
}

function analysisAnswer(depts: Array<{ key: string }>, plans: Unit[]) {
  const candidates: unknown[] = [];
  if (depts.length >= 2) {
    const a = plans.find((p) => p.dept === depts[0].key);
    const b = plans.find((p) => p.dept === depts[1].key);
    if (a && b) {
      candidates.push({
        kind: 'duplicate',
        title: '既存顧客への重複施策',
        summary: `「${a.title}」と「${b.title}」が、同じ既存顧客を別々の部門から狙っている。担当を一本化する余地がある。`,
        departmentKeys: [depts[0].key, depts[1].key],
        planRefs: [
          { departmentKey: depts[0].key, projectId: a.id },
          { departmentKey: depts[1].key, projectId: b.id },
        ],
        dialogueTopics: ['既存顧客の担当をどちらが持つか'],
      });
    }
    // 存在しないIDを出す候補（採用されず、件数が利用者に示されることを確かめるため）
    candidates.push({
      kind: 'collaboration',
      title: '存在しない計画を指す候補',
      summary: '検証用：存在しない計画IDを含む。',
      departmentKeys: [depts[0].key, depts[1].key],
      planRefs: [{ departmentKey: depts[0].key, projectId: 'id:fake-999' }],
      dialogueTopics: ['存在しない話題'],
    });
  }
  return { candidates };
}

function regenAnswer(user: string) {
  const keys = [...new Set([...user.matchAll(/部門ID=(\S+?)[）)\s]/g)].map((m) => m[1]))];
  return {
    departments: keys.map((k, i) => ({
      departmentKey: k,
      generated: { interDeptCollab: [`協働の案（検証用${i + 1}）：既存顧客の担当を分け、結果を週次で共有する`] },
    })),
  };
}

export const openai = {
  chat: {
    completions: {
      create: async (params: { messages: Msg[] }) => {
        const system = params.messages[0].content;
        const user = params.messages[1].content;
        const { depts, plans } = parseUnits(user);
        const content = system.includes('調整候補を挙げます') ? analysisAnswer(depts, plans) : regenAnswer(user);
        return { choices: [{ message: { content: JSON.stringify(content) } }] };
      },
    },
  },
};
