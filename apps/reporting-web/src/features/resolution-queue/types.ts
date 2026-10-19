import {
  RESOLUTION_KIND,
  RESOLUTION_TYPE,
  RESOLUTION_WORKFLOW_STATUS,
} from '@qakit/reporting-shared';
import type {
  ResolutionKind,
  ResolutionType,
  ResolutionWorkflowStatus,
} from '@qakit/reporting-shared';
import type { StatusTone } from '../../shared/components/StatusChip';

/**
 * Presentation vocabulary for the Resolution Queue.
 *
 * The wire enums are terse by design; these are the words a QA lead reads. They live here rather
 * than inline in the components because the list, the detail header and the dashboard tiles must
 * agree — a status that reads "Ready for rerun" in one place and "Ready" in another looks like
 * two different states.
 */

export const WORKFLOW_STATUS_LABEL: Record<ResolutionWorkflowStatus, string> = {
  [RESOLUTION_WORKFLOW_STATUS.OPEN]: 'Open',
  [RESOLUTION_WORKFLOW_STATUS.WAITING_FOR_DECISION]: 'Waiting for decision',
  [RESOLUTION_WORKFLOW_STATUS.DECIDED]: 'Decided',
  [RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN]: 'Ready for rerun',
  [RESOLUTION_WORKFLOW_STATUS.VERIFIED]: 'Verified',
  [RESOLUTION_WORKFLOW_STATUS.RECURRED]: 'Recurred',
  [RESOLUTION_WORKFLOW_STATUS.WONT_RESOLVE]: 'Won’t resolve',
};

/**
 * Tones follow "does this still need someone?" rather than good/bad. RECURRED is an error tone
 * because evidence came back after a verification — the one state that should pull the eye.
 */
export const WORKFLOW_STATUS_TONE: Record<ResolutionWorkflowStatus, StatusTone> = {
  [RESOLUTION_WORKFLOW_STATUS.OPEN]: 'neutral',
  [RESOLUTION_WORKFLOW_STATUS.WAITING_FOR_DECISION]: 'warning',
  [RESOLUTION_WORKFLOW_STATUS.DECIDED]: 'info',
  [RESOLUTION_WORKFLOW_STATUS.READY_FOR_RERUN]: 'info',
  [RESOLUTION_WORKFLOW_STATUS.VERIFIED]: 'success',
  [RESOLUTION_WORKFLOW_STATUS.RECURRED]: 'error',
  [RESOLUTION_WORKFLOW_STATUS.WONT_RESOLVE]: 'neutral',
};

export const KIND_LABEL: Record<ResolutionKind, string> = {
  [RESOLUTION_KIND.SPEC_DECISION]: 'Spec decision',
  [RESOLUTION_KIND.TEST_DATA]: 'Test data',
  [RESOLUTION_KIND.ENVIRONMENT]: 'Environment',
  [RESOLUTION_KIND.AUTOMATION]: 'Automation',
  [RESOLUTION_KIND.MISSING_IMPLEMENTATION]: 'Missing implementation',
  [RESOLUTION_KIND.PRODUCT_DEFECT]: 'Product defect',
  [RESOLUTION_KIND.UNCLASSIFIED]: 'Unclassified',
};

/** One line each, shown in the classify control so the choice is not a guess. */
export const KIND_HINT: Record<ResolutionKind, string> = {
  [RESOLUTION_KIND.SPEC_DECISION]: 'The source is ambiguous or contradictory — a BA must choose.',
  [RESOLUTION_KIND.TEST_DATA]: 'The environment has no record in the state the assertion needs.',
  [RESOLUTION_KIND.ENVIRONMENT]: 'Infrastructure, credentials or deploy state.',
  [RESOLUTION_KIND.AUTOMATION]: 'The harness cannot drive or observe it.',
  [RESOLUTION_KIND.MISSING_IMPLEMENTATION]: 'Specified, but not built yet.',
  [RESOLUTION_KIND.PRODUCT_DEFECT]: 'Confirmed product defect — the only kind that goes to Redmine.',
  [RESOLUTION_KIND.UNCLASSIFIED]: 'Imported. Nobody has triaged it yet.',
};

export const RESOLUTION_TYPE_LABEL: Record<ResolutionType, string> = {
  [RESOLUTION_TYPE.SPEC_CLARIFIED]: 'Spec clarified',
  [RESOLUTION_TYPE.DATA_PREPARED]: 'Data prepared',
  [RESOLUTION_TYPE.ENVIRONMENT_FIXED]: 'Environment fixed',
  [RESOLUTION_TYPE.AUTOMATION_FIXED]: 'Automation fixed',
  [RESOLUTION_TYPE.PRODUCT_FIXED]: 'Product fixed',
  [RESOLUTION_TYPE.DUPLICATE]: 'Duplicate',
  [RESOLUTION_TYPE.WONT_RESOLVE]: 'Won’t resolve',
};

/**
 * The four verbs, spelled out wherever they appear. Users conflate them constantly — a comment
 * gets treated as a decision, a resolution as proof it works — and the whole workflow depends on
 * the distinction, so the UI states it rather than assuming it.
 */
export const VERB_EXPLANATION = {
  comment: 'Discussion. Adding one never changes the status.',
  decision: 'The authoritative answer: what the system is supposed to do.',
  resolution: 'What was actually changed or prepared, based on the decision.',
  verification: 'Evidence from a later test execution that it worked.',
} as const;

/** Where the self-asserted actor name is remembered between visits. */
export const ACTOR_STORAGE_KEY = 'qakit-reporting.resolution-actor';
