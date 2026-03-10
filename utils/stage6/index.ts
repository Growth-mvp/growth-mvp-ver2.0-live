/**
 * STAGE6 utilities re-export
 */

export type {
  ApprovedProject,
  ProjectContribution,
  NorthStarRow,
  IssueResolution,
  Stage6Core,
} from './types';

export { mkBaseFigures, mkBaselineTrajectory } from './baseline';

export {
  fmtJPY,
  compactJPY,
  normalizeValueToUnit,
  extractMetricFromYearlyPL,
  calculateAchievementRate,
  getTopContributingProjects,
  getEvidenceFromProject,
  diffYearly,
  sumYearly,
  buildNorthStarRows,
  buildIssueResolutions,
  buildValueAnalysisCards,
  buildProjectContributions,
} from './compute';

export { getExecutionWeight, matchProgressLogToProject, normalizeProjectName } from './execution';

export {
  calculateForecastWithImpacts,
  calculateIssueResolutionWithLinks,
  buildNorthStarRowsPhaseE,
  buildIssueResolutionsPhaseE,
} from './phaseE';
