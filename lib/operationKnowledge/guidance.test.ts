import {
  GUIDANCE_CHAR_BUDGET,
  GUIDANCE_MAX_OPERATIONS,
  buildOperationGuidance,
  detectMentionedScreenIds,
  detectOperationIntent,
  normalizeRole,
} from './guidance';
import { SCREENS } from '@/lib/screens/screenRegistry';
import { OPERATIONS } from './operations';

const REQUIRED_QUESTIONS = [
  'この画面では何をすればいい？',
  'SWOT分析のたたき台を生成するには？',
  'STAGE3では何をするの？',
  '経営計画書を作るには？',
  '組織変革ルームはどう使うの？',
  '保存するにはどうすればいい？',
  '次は何をすればいい？',
];

const ENABLED_SCREEN_IDS = SCREENS.filter((s) => s.helpEnabled === true).map((s) => s.id);

describe('操作の意図の判定', () => {
  it.each(REQUIRED_QUESTIONS)('操作質問として判定する：%s', (q) => {
    expect(detectOperationIntent(q)).toBe(true);
  });

  it.each(['売上を伸ばすには？', 'SWOTの強みを増やすには？', '経営の方向性をどう考えればいい？'])(
    '経営相談は操作質問として扱わない：%s',
    (q) => {
      expect(detectOperationIntent(q)).toBe(false);
    }
  );

  it('空の入力は操作質問ではない', () => {
    expect(detectOperationIntent('')).toBe(false);
  });
});

describe('対象画面の検出', () => {
  it('STAGE番号から画面を特定する', () => {
    expect(detectMentionedScreenIds('STAGE3では何をするの？')).toEqual(['stage3']);
    expect(detectMentionedScreenIds('stage5 の使い方')).toEqual(['stage5']);
  });

  it('経営計画書と組織変革ルームの言及から、関連する画面を特定する', () => {
    expect(detectMentionedScreenIds('経営計画書を作るには？').sort()).toEqual(
      ['plan-bank', 'plan-employee', 'plan-hub', 'plan-shareholder'].sort()
    );
    expect(detectMentionedScreenIds('組織変革ルームはどう使うの？').sort()).toEqual(['org-personal', 'org-shared']);
  });

  it('画面の言及がなければ、空を返す', () => {
    expect(detectMentionedScreenIds('この画面では何をすればいい？')).toEqual([]);
  });
});

describe('権限の正規化', () => {
  it('不明な値は一般社員として扱う（最小権限）', () => {
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('manager')).toBe('manager');
    expect(normalizeRole('member')).toBe('member');
    expect(normalizeRole('owner')).toBe('member');
    expect(normalizeRole(undefined)).toBe('member');
    expect(normalizeRole(null)).toBe('member');
  });
});

describe('操作質問への案内（登録簿に基づく）', () => {
  it('「SWOT分析のたたき台を生成するには？」には、STAGE2のたたき台の操作を、ラベルと手順付きで提供する', () => {
    const r = buildOperationGuidance({
      screenId: 'stage2',
      query: 'SWOT分析のたたき台を生成するには？',
      role: 'admin',
    });
    expect(r.text).toContain('「たたき台を生成」（stage2.generate-draft）');
    expect(r.text).toContain('手順: 1.');
    expect(r.text).toContain('/stage2');
    expect(r.operationCount).toBeGreaterThan(0);
  });

  it('「この画面では何をすればいい？」には、現在の画面の主要な操作を示す', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: 'この画面では何をすればいい？', role: 'member' });
    expect(r.text).toContain('■ STAGE1 会社の現状はどうか（/stage1）');
    expect(r.operationCount).toBeGreaterThan(0);
    expect(r.operationCount).toBeLessThanOrEqual(GUIDANCE_MAX_OPERATIONS);
  });

  it('「STAGE3では何をするの？」は、現在の画面（STAGE1）ではなく STAGE3 の登録済み操作を検索して提供する', () => {
    const admin = buildOperationGuidance({ screenId: 'stage1', query: 'STAGE3では何をするの？', role: 'admin' });
    expect(admin.text).toContain('■ STAGE3 各部門の役割は何か（/cascade）');
    expect(admin.text).toContain('「部門を追加」');
    expect(admin.text).not.toContain('（stage1.');
  });

  it('「経営計画書を作るには？」は、管理職には生成の操作を、経営計画書の画面の情報とともに提供する', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: '経営計画書を作るには？', role: 'manager' });
    expect(r.text).toContain('「AI本文を生成」');
    expect(r.text).toContain('「計画書を見る」');
  });

  it('「組織変革ルームはどう使うの？」は、一般社員にも使える組織変革の操作を提供する', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: '組織変革ルームはどう使うの？', role: 'member' });
    expect(r.text).toContain('「このルームの使い方」');
    expect(r.text).toContain('（/org-transformation/shared）');
  });

  it('「保存するにはどうすればいい？」は、全画面共通の保存操作を含む', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: '保存するにはどうすればいい？', role: 'admin' });
    expect(r.text).toContain('「全体保存」');
  });

  it('「次は何をすればいい？」は、STAGE1 の次の画面（STAGE2）を示す', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: '次は何をすればいい？', role: 'member' });
    expect(r.text).toContain('次の画面: STAGE2 会社は何を目指すのか（/stage2）');
  });

  it('未確認の保存方法は、確定した事実として案内しない', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: '分析を更新するには？', role: 'admin' });
    expect(r.text).toContain('「分析を更新」');
    expect(r.text).toContain('保存: 未確認（案内しない）');
  });

  it('形式は「ラベル・手順・条件・権限・保存」の順で、ルールの文面を含む', () => {
    const r = buildOperationGuidance({ screenId: 'stage2', query: 'たたき台を生成するには？', role: 'admin' });
    expect(r.text).toContain('条件:');
    expect(r.text).toContain('権限:');
    expect(r.text).toContain('保存:');
    expect(r.text).toContain('【回答の原則（操作案内）】');
  });
});

describe('権限による絞り込み', () => {
  it('一般社員には、管理者のみの操作（たたき台の生成）を案内しない', () => {
    const r = buildOperationGuidance({ screenId: 'stage2', query: 'SWOT分析のたたき台を生成するには？', role: 'member' });
    expect(r.text).not.toContain('「たたき台を生成」（stage2.generate-draft）');
    expect(r.text).toContain('権限により、一部の操作は案内の対象外です');
    expect(r.excludedByRole).toBeGreaterThan(0);
  });

  it('管理職には、管理者のみの操作を案内しない', () => {
    const r = buildOperationGuidance({ screenId: 'stage3', query: '部門を追加するには？', role: 'manager' });
    expect(r.text).not.toContain('「部門を追加」');
  });

  it('管理者には、管理者のみの操作も案内する', () => {
    const r = buildOperationGuidance({ screenId: 'stage3', query: '部門を追加するには？', role: 'admin' });
    expect(r.text).toContain('「部門を追加」');
    expect(r.text).toContain('権限: 管理者のみ');
  });
});

describe('登録簿に情報がない場合・画面が特定できない場合', () => {
  it('用途未確定の画面（/stage4）では、操作を推測せず、情報がないと伝える', () => {
    const r = buildOperationGuidance({ screenId: 'stage4-page', query: 'この画面では何をすればいい？', role: 'admin' });
    expect(r.operationCount).toBe(0);
    expect(r.text).toContain('操作情報は登録されていません');
    expect(r.text).not.toContain('（stage4.');
  });

  it('案内を有効にしていない画面（管理画面）では、操作を案内しない', () => {
    const r = buildOperationGuidance({ screenId: 'admin-members', query: '使い方を教えて', role: 'admin' });
    expect(r.operationCount).toBe(0);
    expect(r.text).toContain('登録されていません');
  });

  it('画面が特定できず、言及もない場合は、画面を一つだけ尋ねるよう指示する', () => {
    const r = buildOperationGuidance({ screenId: null, query: 'この画面では何をすればいい？', role: 'member' });
    expect(r.operationCount).toBe(0);
    expect(r.text).toContain('現在の画面を特定できない');
    expect(r.text).toContain('どの画面');
  });

  it('登録にないボタン名を尋ねられた場合は、登録にない操作を案内しないルールを含む', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: 'ホームのレポートボタンはどこ？', role: 'admin' });
    expect(r.text).toContain('登録にない操作は案内しない');
    expect(r.text).toContain('上の操作一覧にない操作・ボタン・機能は案内しない');
  });

  it('操作質問でなければ、案内の文面は作らない（経営相談と混同しない）', () => {
    expect(buildOperationGuidance({ screenId: 'stage2', query: '売上を伸ばすには？', role: 'admin' }).text).toBe('');
  });
});

describe('注入量の上限', () => {
  const queries = [...REQUIRED_QUESTIONS, '登録にないボタンはどこ？', 'ステージ2の操作を全部教えて'];
  const roles = ['member', 'manager', 'admin'] as const;

  it('どの画面・質問・権限でも、案内の文字数は上限を超えず、件数は上限以内', () => {
    for (const screenId of [...ENABLED_SCREEN_IDS, 'stage4-page', null]) {
      for (const query of queries) {
        for (const role of roles) {
          const r = buildOperationGuidance({ screenId, query, role });
          expect({ screenId, query, role, ok: r.text.length <= GUIDANCE_CHAR_BUDGET }).toEqual({
            screenId,
            query,
            role,
            ok: true,
          });
          expect(r.operationCount).toBeLessThanOrEqual(GUIDANCE_MAX_OPERATIONS);
        }
      }
    }
  });

  it('全67件を一度に投入しない', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: '全部教えて操作', role: 'admin' });
    expect(r.operationCount).toBeLessThan(OPERATIONS.length);
  });
});
