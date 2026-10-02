/** Agent Core : demande, intention, cycle agentique. */

export type { AgentCoreOptions, Analysis, RunOptions, RunResult } from './core.js';
export {
  AgentCore,
  EXECUTION_BOUNDARY,
  PLAN_STEPS_SCHEMA,
} from './core.js';
export type { IntentRecordInit } from './intent.js';
export {
  analyzeSignals,
  classifyWithLLM,
  INTENT_CATEGORIES,
  INTENT_CLASSIFICATION_SCHEMA,
  IntentCategory,
  IntentRecord,
  MAX_INFERRED_CONFIDENCE,
  QUESTION_SANS_SIGNAL,
  SIGNAL_CATEGORIES,
} from './intent.js';
export type { RequestInit } from './request.js';
export { Request, RequestInvalidError } from './request.js';
