/**
 * Vocabulaires canoniques du CodiDev Core.
 *
 * Source unique de vérité pour les états, classes de risque, sévérités et verdicts. Ces valeurs
 * sont référencées par les contrats JSON Schema (`core/schemas/`) et ne doivent jamais être
 * dupliquées en littéraux ailleurs : un test vérifie l'alignement entre les schémas et ce fichier.
 *
 * Aucun `enum` TypeScript n'est utilisé : les unions de littéraux se sérialisent en JSON de façon
 * native, ce qui est indispensable puisque tout ce qui traverse le cœur est validé et journalisé.
 *
 * Règle opposable : « A failed or blocked action is never reported as successful. » Elle est
 * encodée par `impliesCompletion`, qui n'est vraie que pour `VERIFIED` — jamais pour `EXECUTED`.
 */

/** Statut réel d'une opération. */
export const OperationStatus = {
  NotExecuted: 'NOT_EXECUTED',
  Blocked: 'BLOCKED',
  Failed: 'FAILED',
  WaitingForUser: 'WAITING_FOR_USER',
  Executed: 'EXECUTED',
  Verified: 'VERIFIED',
} as const;
export type OperationStatus = (typeof OperationStatus)[keyof typeof OperationStatus];

export const OPERATION_STATUSES: readonly OperationStatus[] = Object.values(OperationStatus);

/**
 * `EXECUTED` signifie « l'action a été exécutée », jamais « le résultat est conforme ».
 * Seul `VERIFIED` atteste que les critères de vérification ont été satisfaits.
 */
export function impliesCompletion(status: OperationStatus): boolean {
  return status === OperationStatus.Verified;
}

/** `BLOCKED` et `FAILED` sont des échecs ; `WAITING_FOR_USER` est une attente. */
export function isFailure(status: OperationStatus): boolean {
  return status === OperationStatus.Blocked || status === OperationStatus.Failed;
}

/** États du Task Engine. */
export const TaskState = {
  Draft: 'DRAFT',
  Analyzing: 'ANALYZING',
  Proposed: 'PROPOSED',
  WaitingForUser: 'WAITING_FOR_USER',
  InProgress: 'IN_PROGRESS',
  Blocked: 'BLOCKED',
  Failed: 'FAILED',
  Executed: 'EXECUTED',
  Verifying: 'VERIFYING',
  Verified: 'VERIFIED',
  Ready: 'READY',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
} as const;
export type TaskState = (typeof TaskState)[keyof typeof TaskState];

export const TASK_STATES: readonly TaskState[] = Object.values(TaskState);

/**
 * Transitions autorisées du Task Engine. Toute transition absente de cette table est refusée :
 * c'est la seule autorité sur ce qui peut suivre quoi.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  DRAFT: ['ANALYZING', 'CANCELLED'],
  ANALYZING: ['PROPOSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  PROPOSED: ['WAITING_FOR_USER', 'IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  WAITING_FOR_USER: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'FAILED', 'EXECUTED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'FAILED', 'CANCELLED'],
  FAILED: ['IN_PROGRESS', 'CANCELLED'],
  EXECUTED: ['VERIFYING', 'FAILED'],
  VERIFYING: ['VERIFIED', 'FAILED', 'BLOCKED'],
  VERIFIED: ['READY'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Indique si `source -> target` figure dans la table des transitions autorisées. */
export function isAllowedTransition(source: TaskState, target: TaskState): boolean {
  return TASK_TRANSITIONS[source].includes(target);
}

/** Classes d'action. */
export const RiskClass = {
  Read: 'READ',
  LowWrite: 'LOW_WRITE',
  Write: 'WRITE',
  SensitiveWrite: 'SENSITIVE_WRITE',
  Destructive: 'DESTRUCTIVE',
  ExternalSideEffect: 'EXTERNAL_SIDE_EFFECT',
  Deployment: 'DEPLOYMENT',
  SecuritySensitive: 'SECURITY_SENSITIVE',
} as const;
export type RiskClass = (typeof RiskClass)[keyof typeof RiskClass];

export const RISK_CLASSES: readonly RiskClass[] = Object.values(RiskClass);

/** Classes dont la moindre occurrence exige un Human Gate explicite. */
export function requiresHumanApproval(riskClass: RiskClass): boolean {
  return (
    riskClass === RiskClass.SensitiveWrite ||
    riskClass === RiskClass.Destructive ||
    riskClass === RiskClass.ExternalSideEffect ||
    riskClass === RiskClass.Deployment ||
    riskClass === RiskClass.SecuritySensitive
  );
}

/** Niveaux de sévérité d'une constatation de sécurité. */
export const Severity = {
  Info: 'INFO',
  Low: 'LOW',
  Medium: 'MEDIUM',
  High: 'HIGH',
  Critical: 'CRITICAL',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const SEVERITIES: readonly Severity[] = Object.values(Severity);

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

/** Verdict du Security Gate. */
export const GateOutcome = {
  Pass: 'PASS',
  Review: 'REVIEW',
  Block: 'BLOCK',
} as const;
export type GateOutcome = (typeof GateOutcome)[keyof typeof GateOutcome];

const GATE_EXIT_CODES: Readonly<Record<GateOutcome, number>> = {
  PASS: 0,
  REVIEW: 1,
  BLOCK: 2,
};

/** Code de sortie conventionnel : 0 = PASS, 1 = REVIEW, 2 = BLOCK. */
export function gateExitCode(outcome: GateOutcome): number {
  return GATE_EXIT_CODES[outcome];
}

/** Issue d'une décision de politique. */
export const PolicyOutcome = {
  Allow: 'ALLOW',
  Deny: 'DENY',
  RequireApproval: 'REQUIRE_APPROVAL',
} as const;
export type PolicyOutcome = (typeof PolicyOutcome)[keyof typeof PolicyOutcome];

/**
 * État réel d'exécution d'un outil de sécurité externe.
 * Un outil absent ou en échec est `NOT_EXECUTED` / `FAILED` — jamais « silencieusement vert ».
 */
export const ToolRunState = {
  Executed: 'EXECUTED',
  NotExecuted: 'NOT_EXECUTED',
  Failed: 'FAILED',
} as const;
export type ToolRunState = (typeof ToolRunState)[keyof typeof ToolRunState];
