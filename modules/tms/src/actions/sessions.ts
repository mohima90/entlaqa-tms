'use server';

import { defineAction } from '@jadarat/platform-rbac';
import { sessionDraftActionDefinition } from './session-draft.definition';

/**
 * Example server action (ADR 0003 §4). Until role assignments exist (M2) the default runtime has no
 * grants → always 403 (deny by default).
 */
export const createSessionDraft = defineAction(sessionDraftActionDefinition());
