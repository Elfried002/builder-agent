/**
 * Erreurs du CodiDev Core.
 *
 * Principe opposable : une erreur n'est jamais convertie en succès. Chaque erreur porte un
 * `status` issu de `OperationStatus`, de sorte que l'appelant qui capture l'erreur dispose déjà
 * du statut réel à consigner dans les preuves et l'audit.
 */

import { OperationStatus } from './statuses.js';

export interface CodiDevErrorOptions {
  /** Contexte structuré, sérialisable, destiné aux preuves. */
  readonly context?: Record<string, unknown>;
  /** Cause d'origine, si l'erreur en enveloppe une autre. */
  readonly cause?: unknown;
}

/** Racine des erreurs CodiDev. */
export class CodiDevError extends Error {
  readonly status: OperationStatus;
  readonly context: Record<string, unknown>;

  constructor(message: string, options: CodiDevErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = OperationStatus.Failed;
    this.context = options.context ?? {};
  }

  /** Représentation sérialisable, telle qu'elle sera journalisée. */
  toJSON(): Record<string, unknown> {
    return {
      error: this.name,
      message: this.message,
      status: this.status,
      context: this.context,
    };
  }
}

/** Définitions dont le statut diffère de `FAILED`. Chacune porte son statut réel. */

/** Un document ne satisfait pas son contrat JSON Schema. */
export class ContractError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/** Un secret a été détecté là où il ne doit jamais y en avoir. */
export class SecretDetectedError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/** Le Security Gate a refusé l'opération. */
export class GateBlockedError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/** La politique a refusé l'action demandée. */
export class PolicyDeniedError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/** L'action exige une approbation humaine qui n'a pas été accordée. */
export class ApprovalRequiredError extends CodiDevError {
  override readonly status = OperationStatus.WaitingForUser;
}

/** La chaîne de hachage d'un journal a été altérée. */
export class ChainIntegrityError extends CodiDevError {
  override readonly status = OperationStatus.Failed;
}

/** Une capacité non déclarée a été demandée : point ouvert, jamais d'élargissement silencieux. */
export class CapabilityNotDeclaredError extends CodiDevError {
  override readonly status = OperationStatus.NotExecuted;
}

/** Une règle d'isolation du contexte a été violée (tenant, provenance, portée). */
export class ContextIsolationError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/** Un plan ne satisfait pas ses invariants : ordre, dépendances, critères, rollback. */
export class PlanInvalidError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/** Une transition de tâche interdite a été demandée. */
export class TaskTransitionError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/** Une étape exige une vérification réelle qui n'a pas été fournie. */
export class VerificationRequiredError extends CodiDevError {
  override readonly status = OperationStatus.Blocked;
}

/**
 * Le cœur a atteint la frontière d'exécution, qui n'est pas encore construite.
 * Statut `NOT_EXECUTED` : rien n'a été exécuté, et rien ne sera présenté comme exécuté.
 */
export class ExecutionNotAvailableError extends CodiDevError {
  override readonly status = OperationStatus.NotExecuted;
}

/** Un appel au fournisseur LLM a échoué. Ne transporte jamais de secret. */
export class LLMProviderError extends CodiDevError {
  override readonly status = OperationStatus.Failed;
}
