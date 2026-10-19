export type PlanAudience = 'bank' | 'shareholder' | 'employee';

export type PlanRole = 'admin' | 'manager' | 'member' | null | undefined;

export type PlanScope = {
  companyId: string;
  strategyId: string;
  audience: PlanAudience;
};

export type PlanDocument = {
  scopeKey: string;
  saveStatus: 'saved' | 'unsaved';
  saveReason: 'conflict' | 'error' | null;
  generatedText: string;
  sections: string[];
  generatedAt: string;
  version: number | null;
};

export type GenerateResponseBody = {
  generatedText: string;
  sections: string[];
  generatedAt: string;
  status: 'saved' | 'unsaved';
  version: number | null;
  saveReason: 'conflict' | 'error' | null;
};

export function scopeKey(scope: PlanScope): string {
  return `${scope.companyId}|${scope.strategyId}|${scope.audience}`;
}

export function visibleDocument(doc: PlanDocument | null, currentKey: string): PlanDocument | null {
  return doc !== null && doc.scopeKey === currentKey ? doc : null;
}

export function canGeneratePlan(role: PlanRole): boolean {
  return role === 'admin' || role === 'manager';
}

export function toPlanDocument(scope: PlanScope, body: GenerateResponseBody): PlanDocument {
  return {
    scopeKey: scopeKey(scope),
    saveStatus: body.status,
    saveReason: body.status === 'unsaved' ? body.saveReason : null,
    generatedText: body.generatedText,
    sections: body.sections,
    generatedAt: body.generatedAt,
    version: body.status === 'saved' ? body.version : null,
  };
}

export function isUnsaved(doc: PlanDocument | null): boolean {
  return doc !== null && doc.saveStatus === 'unsaved';
}

export function markdownFileName(audience: PlanAudience, generatedAt: string): string {
  const date = new Date(generatedAt);
  const stamp = Number.isNaN(date.getTime())
    ? 'undated'
    : date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${audience}-plan-${stamp}.md`;
}
