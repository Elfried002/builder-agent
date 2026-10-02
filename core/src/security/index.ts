/**
 * Sécurité du Core : détection de secrets, rapport, gate, outils, exceptions revues.
 *
 * La sécurité n'est pas une autorité du modèle : elle lit des faits observés.
 */

export type { AllowlistEntry } from './allowlist.js';
export {
  ALLOWLIST_FILENAME,
  entryMatches,
  SecurityAllowlist,
} from './allowlist.js';
export type { GateAction, GatePolicy, GateResult, PolicyName } from './gate.js';
export {
  ACTION_BLOCK,
  ACTION_INFORMATIONAL,
  ACTION_REVIEW,
  ACTION_WARNING,
  DEFAULT_POLICY,
  evaluate,
  gateResultToJSON,
  policyByName,
  STRICT_POLICY,
} from './gate.js';
export type { Finding, SuppressedFinding, ToolRun } from './report.js';
export { SecurityReport } from './report.js';
export type { SecretRule } from './secrets.js';
export {
  containsRedactionMarker,
  DEFAULT_RULES,
  DEFAULT_SKIP_DIRS,
  DEFAULT_SKIP_SUFFIXES,
  isPlausibleSecret,
  iterFiles,
  looksLikeLiteralSecret,
  looksLikePassword,
  MAX_SCAN_BYTES,
  MIN_VALUE_ENTROPY,
  PLACEHOLDER_PASSWORDS,
  PLACEHOLDER_VALUES,
  REDACTION_TOKEN,
  redact,
  redactionMark,
  redactStructure,
  SecretScanner,
  shannonEntropy,
} from './secrets.js';
export type { RunToolOptions, ToolSpec } from './tools.js';
export {
  DEFAULT_TIMEOUT_MS,
  packageRoot,
  parseBiome,
  parseNpmAudit,
  resolveExecutable,
  runTool,
  runTools,
  TOOL_SPECS,
} from './tools.js';
