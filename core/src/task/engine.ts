/**
 * Task Engine — machine à états observable.
 *
 * Trois règles sont appliquées par du code, pas par convention :
 *
 * 1. **Aucune transition hors table.** La table canonique de `statuses.ts` est la seule autorité.
 * 2. **Aucune vérification sans vérification.** Passer à `VERIFIED` exige un résultat de
 *    vérification réellement exécuté et réussi ; une déclaration ne suffit pas.
 * 3. **Aucun succès implicite.** `COMPLETED` n'est atteignable qu'après `VERIFIED`, parce que le
 *    corpus interdit de présenter comme terminé un résultat non vérifié.
 *
 * Chaque transition — création comprise — est consignée dans l'historique de la tâche et, lorsque
 * les journaux sont fournis, dans les preuves et l'audit.
 *
 * Les journaux sont injectés via des interfaces **structurelles minimales** définies ici : ce
 * module ne dépend donc d'aucun fichier de journal, et reste compilable indépendamment de leur
 * écriture en parallèle.
 */

import { validate } from '../contracts.js';
import { TaskTransitionError, VerificationRequiredError } from '../errors.js';
import { newId, utcNowIso } from '../ids.js';
import { isAllowedTransition, OperationStatus, RiskClass, TaskState } from '../statuses.js';

/**
 * Résultat d'une vérification réellement exécutée.
 *
 * Ce type est volontairement défini localement (plutôt qu'importé) pour ne pas coupler ce module au
 * magasin de preuves en cours d'écriture : il suffit qu'un objet expose ces trois champs.
 */
export interface ValidationOutcome {
  readonly criteria: readonly string[];
  readonly performed: boolean;
  readonly passed: boolean;
}

/** Détail transmis à un journal de preuves. */
export interface EvidenceRecordOptions {
  readonly actor: string;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly resource: string;
  readonly warnings: readonly string[] | null;
  readonly validation: ValidationOutcome | null;
  readonly externalIds: Readonly<Record<string, string>>;
}

/**
 * Interface minimale du journal de preuves. On n'attend qu'un `record` asynchrone : toute
 * implémentation conforme (celle du magasin de preuves comme un double de test) peut être
 * injectée.
 */
export interface EvidenceJournal {
  record(
    operation: string,
    status: OperationStatus,
    options: EvidenceRecordOptions,
  ): Promise<unknown>;
}

/** Détail transmis au journal d'audit. */
export interface AuditActionRecord {
  readonly actor: string;
  readonly action: string;
  readonly resource: string;
  readonly riskClass: RiskClass;
  readonly result: OperationStatus;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly evidenceId: string | null;
}

/** Interface minimale du journal d'audit ; chaînable avec l'identifiant de preuve. */
export interface AuditJournal {
  recordAction(record: AuditActionRecord): Promise<unknown>;
}

/** Paramètres de construction d'un événement de tâche. */
export interface TaskEventInit {
  readonly seq: number;
  readonly fromState: TaskState | null;
  readonly toState: TaskState;
  readonly at: string;
  readonly reason: string | null;
  readonly actor: string;
}

/** Transition observée : d'où, vers quoi, quand, pourquoi, par qui. */
export class TaskEvent {
  readonly seq: number;
  readonly fromState: TaskState | null;
  readonly toState: TaskState;
  readonly at: string;
  readonly reason: string | null;
  readonly actor: string;

  constructor(init: TaskEventInit) {
    this.seq = init.seq;
    this.fromState = init.fromState;
    this.toState = init.toState;
    this.at = init.at;
    this.reason = init.reason;
    this.actor = init.actor;
  }

  /**
   * Forme sérialisable attendue par le contrat `task`. `seq` et `actor` restent des données
   * d'exploitation internes : le contrat d'historique ne les accepte pas (`additionalProperties:
   * false`), ils ne sont donc pas exportés ici.
   */
  toDict(): Record<string, unknown> {
    return {
      from: this.fromState,
      to: this.toState,
      at: this.at,
      reason: this.reason,
    };
  }
}

/** États finaux : aucune sortie possible. */
const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  TaskState.Completed,
  TaskState.Cancelled,
]);

/** Paramètres de construction d'une tâche. */
export interface TaskInit {
  readonly objective: string;
  readonly taskId?: string;
  readonly state?: TaskState;
  readonly riskClass?: RiskClass;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
  readonly planId?: string | null;
  readonly decisionId?: string | null;
  readonly history?: TaskEvent[];
}

/** Tâche du Task Engine. `state` et `history` sont mutables : ce sont les seules évolutions. */
export class Task {
  readonly taskId: string;
  state: TaskState;
  readonly objective: string;
  readonly riskClass: RiskClass;
  readonly createdAt: string;
  updatedAt: string;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly planId: string | null;
  readonly decisionId: string | null;
  readonly history: TaskEvent[];

  constructor(init: TaskInit) {
    this.taskId = init.taskId ?? newId('task');
    this.objective = init.objective;
    this.state = init.state ?? TaskState.Draft;
    this.riskClass = init.riskClass ?? RiskClass.Read;
    this.createdAt = init.createdAt ?? utcNowIso();
    this.updatedAt = init.updatedAt ?? this.createdAt;
    this.tenantId = init.tenantId ?? null;
    this.projectId = init.projectId ?? null;
    this.planId = init.planId ?? null;
    this.decisionId = init.decisionId ?? null;
    this.history = init.history ?? [];
  }

  /** Vrai si la tâche est dans un état terminal. */
  get isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }

  /** Représentation conforme au contrat `task`. */
  toDict(): Record<string, unknown> {
    return {
      task_id: this.taskId,
      state: this.state,
      objective: this.objective,
      tenant_id: this.tenantId,
      project_id: this.projectId,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      history: this.history.map((event) => event.toDict()),
    };
  }

  /** Valide la tâche contre son contrat et lève `ContractError` sinon. */
  validate(): void {
    validate('task', this.toDict());
  }
}

/** Correspondance état de tâche → statut d'opération consigné dans les preuves. */
const STATUS_BY_STATE: Readonly<Partial<Record<TaskState, OperationStatus>>> = {
  WAITING_FOR_USER: OperationStatus.WaitingForUser,
  BLOCKED: OperationStatus.Blocked,
  FAILED: OperationStatus.Failed,
  VERIFIED: OperationStatus.Verified,
};

/**
 * Vrai si la tâche est réellement passée par `VERIFIED` au cours de son histoire.
 *
 * La table de transitions interdit déjà d'atteindre `READY` sans `VERIFIED` ; ce contrôle
 * redondant protège l'invariant si la table évolue, plutôt que de faire confiance à un
 * raisonnement sur le graphe.
 */
function wasVerified(task: Task): boolean {
  return task.history.some((event) => event.toState === TaskState.Verified);
}

/** Extrait l'identifiant de preuve d'un enregistrement renvoyé, sans présumer de sa forme. */
function evidenceIdOf(value: unknown): string | null {
  if (value !== null && typeof value === 'object' && 'evidence_id' in value) {
    const id = (value as Record<string, unknown>).evidence_id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

/** Options d'ouverture d'une tâche. */
export interface OpenOptions {
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
  readonly planId?: string | null;
  readonly decisionId?: string | null;
  readonly riskClass?: RiskClass;
  readonly actor?: string | null;
}

/** Options d'une transition. */
export interface TransitionOptions {
  readonly reason?: string | null;
  readonly actor?: string | null;
  readonly validation?: ValidationOutcome | null;
}

/** Détail interne d'une consignation. */
interface JournalDetail {
  readonly reason: string | null;
  readonly actor: string;
  readonly validation: ValidationOutcome | null;
}

/** Options de construction du moteur. Les journaux sont optionnels à dessein. */
export interface TaskEngineOptions {
  readonly evidence?: EvidenceJournal;
  readonly audit?: AuditJournal;
  readonly defaultActor?: string;
}

/** Ouvre des tâches et n'autorise que les transitions légitimes. */
export class TaskEngine {
  private readonly evidence: EvidenceJournal | undefined;
  private readonly audit: AuditJournal | undefined;
  private readonly defaultActor: string;

  constructor(options: TaskEngineOptions = {}) {
    this.evidence = options.evidence;
    this.audit = options.audit;
    this.defaultActor = options.defaultActor ?? 'codidev-core';
  }

  /** Ouvre une tâche à l'état `DRAFT` et consigne sa création. */
  async open(objective: string, options: OpenOptions = {}): Promise<Task> {
    const trimmed = objective.trim();
    if (trimmed === '') {
      throw new TaskTransitionError('une tâche sans objectif est refusée');
    }
    const task = new Task({
      objective: trimmed,
      tenantId: options.tenantId ?? null,
      projectId: options.projectId ?? null,
      planId: options.planId ?? null,
      decisionId: options.decisionId ?? null,
      riskClass: options.riskClass ?? RiskClass.Read,
    });
    const motif = 'création de la tâche';
    const actor = options.actor ?? this.defaultActor;
    task.history.push(
      new TaskEvent({
        seq: 0,
        fromState: null,
        toState: TaskState.Draft,
        at: task.createdAt,
        reason: motif,
        actor,
      }),
    );
    await this.journal(task, null, TaskState.Draft, { reason: motif, actor, validation: null });
    task.validate();
    return task;
  }

  /** Applique une transition légitime, ou refuse en nommant la règle violée. */
  async transition(task: Task, target: TaskState, options: TransitionOptions = {}): Promise<Task> {
    if (task.isTerminal) {
      throw new TaskTransitionError('une tâche terminée n’évolue plus', {
        context: { taskId: task.taskId, state: task.state },
      });
    }
    if (!isAllowedTransition(task.state, target)) {
      throw new TaskTransitionError('transition non autorisée', {
        context: { taskId: task.taskId, source: task.state, target },
      });
    }
    const validation = options.validation ?? null;
    if (
      target === TaskState.Verified &&
      (validation === null || !validation.performed || !validation.passed)
    ) {
      throw new VerificationRequiredError(
        'passer à VERIFIED exige une vérification réellement exécutée et réussie',
        { context: { taskId: task.taskId } },
      );
    }
    if (target === TaskState.Completed && !wasVerified(task)) {
      throw new VerificationRequiredError('une tâche ne peut être terminée que vérifiée', {
        context: { taskId: task.taskId, state: task.state },
      });
    }

    const previous = task.state;
    const reason = options.reason ?? null;
    const actor = options.actor ?? this.defaultActor;
    task.state = target;
    task.updatedAt = utcNowIso();
    task.history.push(
      new TaskEvent({
        seq: task.history.length,
        fromState: previous,
        toState: target,
        at: task.updatedAt,
        reason,
        actor,
      }),
    );
    await this.journal(task, previous, target, { reason, actor, validation });
    task.validate();
    return task;
  }

  /**
   * Consigne la transition dans les preuves et l'audit, si les journaux sont fournis.
   *
   * Le statut consigné traduit la réalité : `WAITING_FOR_USER` reste une attente, `BLOCKED` reste
   * un blocage, tout le reste est `EXECUTED` — jamais « vert » par défaut.
   */
  private async journal(
    task: Task,
    previous: TaskState | null,
    target: TaskState,
    detail: JournalDetail,
  ): Promise<void> {
    const status = STATUS_BY_STATE[target] ?? OperationStatus.Executed;
    const operation =
      previous === null ? `task.open:${target}` : `task.transition:${previous}->${target}`;
    const resource = `task:${task.taskId}`;
    let evidenceId: string | null = null;

    if (this.evidence !== undefined) {
      const entry = await this.evidence.record(operation, status, {
        actor: detail.actor,
        tenantId: task.tenantId,
        projectId: task.projectId,
        resource,
        warnings: detail.reason === null || detail.reason === '' ? null : [detail.reason],
        validation: detail.validation,
        externalIds: { task_id: task.taskId },
      });
      evidenceId = evidenceIdOf(entry);
    }

    if (this.audit !== undefined) {
      await this.audit.recordAction({
        actor: detail.actor,
        action: operation,
        resource,
        riskClass: task.riskClass,
        result: status,
        tenantId: task.tenantId,
        projectId: task.projectId,
        evidenceId,
      });
    }
  }
}
