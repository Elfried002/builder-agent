/**
 * Planner — construction et révision de plans d'ingénierie.
 *
 * Porté de `core/python/src/codidev/planner/planner.py`. Un plan porte objectif, exigences,
 * hypothèses, dépendances, étapes ordonnées, sorties attendues, risque, permissions, critères de
 * vérification et rollback. Il **évolue** quand l'exécution produit des faits nouveaux — une
 * révision ne réécrit jamais l'historique, elle produit une nouvelle version qui déclare celle
 * qu'elle remplace.
 *
 * Les invariants ne sont pas décoratifs : un plan sans critère de vérification est un plan qui ne
 * pourra jamais être déclaré terminé, et une étape destructive sans rollback est un aller simple.
 */

import { validate } from '../contracts.js';
import { ContractError, PlanInvalidError } from '../errors.js';
import { newId, utcNowIso } from '../ids.js';
import { RiskClass, requiresHumanApproval } from '../statuses.js';

/** Cycle de vie d'un plan. */
export const PlanStatus = {
  Draft: 'DRAFT',
  Proposed: 'PROPOSED',
  Approved: 'APPROVED',
  Superseded: 'SUPERSEDED',
  Abandoned: 'ABANDONED',
} as const;
export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

export const PLAN_STATUSES: readonly PlanStatus[] = Object.values(PlanStatus);

/**
 * Classes de risque qui imposent un chemin de retour arrière explicite : un aller sans retour
 * possible ne doit pas pouvoir être planifié puis déclaré « terminé » sans trace de sortie.
 */
export const ROLLBACK_REQUIRED: ReadonlySet<RiskClass> = new Set([
  RiskClass.Destructive,
  RiskClass.Deployment,
  RiskClass.SensitiveWrite,
]);

/** Étape de plan : ce qui sera fait, ce qui en est attendu, et comment on le vérifiera. */
export interface PlanStep {
  readonly stepId: string;
  readonly order: number;
  readonly description: string;
  readonly expectedOutput: string;
  readonly riskClass: RiskClass;
  readonly verification: readonly string[];
  readonly dependsOn: readonly string[];
  readonly rollback: string | null;
}

/** Représentation sérialisable d'une étape, alignée sur le contrat `plan`. */
export function planStepToDict(item: PlanStep): Record<string, unknown> {
  return {
    step_id: item.stepId,
    order: item.order,
    description: item.description,
    expected_output: item.expectedOutput,
    risk_class: item.riskClass,
    depends_on: [...item.dependsOn],
    verification: [...item.verification],
    rollback: item.rollback,
  };
}

/** Champs d'une étape passés à `step()`. */
export interface StepOptions {
  readonly expectedOutput: string;
  readonly verification: readonly string[];
  readonly riskClass?: RiskClass;
  readonly dependsOn?: readonly string[];
  readonly rollback?: string | null;
  readonly stepId?: string;
}

/**
 * Construit une étape ; l'ordre est attribué par le plan, pas par l'appelant. Laisser l'appelant
 * fixer un ordre ouvrirait la porte à un trou ou à un doublon dans la séquence.
 */
export function step(description: string, options: StepOptions): PlanStep {
  return {
    stepId: options.stepId ?? newId('step'),
    order: 0,
    description,
    expectedOutput: options.expectedOutput,
    riskClass: options.riskClass ?? RiskClass.Write,
    verification: [...options.verification],
    dependsOn: [...(options.dependsOn ?? [])],
    rollback: options.rollback ?? null,
  };
}

/** Recopie une étape en lui réattribuant un ordre — jamais l'inverse. */
function renumbered(item: PlanStep, order: number): PlanStep {
  return { ...item, order };
}

/** Champs d'un plan. */
export interface PlanFields {
  readonly objective: string;
  readonly steps: readonly PlanStep[];
  readonly planId?: string;
  readonly version?: number;
  readonly status?: PlanStatus;
  readonly supersedes?: string | null;
  readonly requirements?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly risks?: readonly string[];
  readonly rollback?: string | null;
  readonly verificationCriteria?: readonly string[];
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
  readonly taskId?: string | null;
  readonly intentId?: string | null;
  readonly createdAt?: string;
}

/** Plan d'ingénierie versionné. */
export class Plan {
  readonly planId: string;
  readonly objective: string;
  readonly version: number;
  status: PlanStatus;
  readonly supersedes: string | null;
  readonly requirements: readonly string[];
  readonly assumptions: readonly string[];
  readonly dependencies: readonly string[];
  readonly risks: readonly string[];
  readonly rollback: string | null;
  readonly verificationCriteria: readonly string[];
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly intentId: string | null;
  readonly createdAt: string;
  steps: PlanStep[];

  constructor(fields: PlanFields) {
    this.planId = fields.planId ?? newId('plan');
    this.objective = fields.objective;
    this.version = fields.version ?? 1;
    this.status = fields.status ?? PlanStatus.Draft;
    this.supersedes = fields.supersedes ?? null;
    this.requirements = [...(fields.requirements ?? [])];
    this.assumptions = [...(fields.assumptions ?? [])];
    this.dependencies = [...(fields.dependencies ?? [])];
    this.risks = [...(fields.risks ?? [])];
    this.rollback = fields.rollback ?? null;
    this.verificationCriteria = [...(fields.verificationCriteria ?? [])];
    this.tenantId = fields.tenantId ?? null;
    this.projectId = fields.projectId ?? null;
    this.taskId = fields.taskId ?? null;
    this.intentId = fields.intentId ?? null;
    this.createdAt = fields.createdAt ?? utcNowIso();
    this.steps = [...fields.steps];
  }

  /** Permissions exigées : union des classes de risque des étapes, jamais déclarée. */
  get permissions(): RiskClass[] {
    const seen: RiskClass[] = [];
    for (const item of this.steps) {
      if (!seen.includes(item.riskClass)) seen.push(item.riskClass);
    }
    return seen;
  }

  /** Vrai si au moins une étape exige une approbation humaine. */
  get requiresApproval(): boolean {
    return this.steps.some((item) => requiresHumanApproval(item.riskClass));
  }

  /** Étapes dans l'ordre d'exécution. */
  orderedSteps(): PlanStep[] {
    return [...this.steps].sort((left, right) => left.order - right.order);
  }

  toDict(): Record<string, unknown> {
    return {
      plan_id: this.planId,
      objective: this.objective,
      version: this.version,
      supersedes: this.supersedes,
      status: this.status,
      requirements: [...this.requirements],
      assumptions: [...this.assumptions],
      dependencies: [...this.dependencies],
      steps: this.orderedSteps().map(planStepToDict),
      risks: [...this.risks],
      permissions: [...this.permissions],
      verification_criteria: [...this.verificationCriteria],
      rollback: this.rollback,
      tenant_id: this.tenantId,
      project_id: this.projectId,
      task_id: this.taskId,
      intent_id: this.intentId,
      created_at: this.createdAt,
    };
  }

  /**
   * Valide la structure contre le contrat, puis les invariants métier.
   *
   * Les deux familles de règles produisent la même erreur : pour un appelant, un plan est valide
   * ou il ne l'est pas — la distinction schéma / invariants est interne au cœur.
   */
  validate(): void {
    try {
      validate('plan', this.toDict());
    } catch (error) {
      if (error instanceof ContractError) {
        const raw = error.context.violations;
        const violations = Array.isArray(raw) ? raw.map((value) => String(value)) : [];
        throw new PlanInvalidError('plan non conforme à son contrat', {
          context: { violations },
          cause: error,
        });
      }
      throw error;
    }
    const violations = invariantViolations(this);
    if (violations.length > 0) {
      throw new PlanInvalidError('plan non conforme à ses invariants', {
        context: { violations },
      });
    }
  }
}

/**
 * Contrôles qu'un schéma ne peut pas exprimer : ordre, dépendances, rollback, version.
 *
 * Ces règles portent sur les relations entre étapes, pas sur la forme d'un document : elles sont
 * vérifiées ici, une fois, pour tout le cœur.
 */
export function invariantViolations(plan: Plan): string[] {
  const violations: string[] = [];

  if (plan.steps.length === 0) {
    violations.push('un plan doit contenir au moins une étape');
  }
  if (plan.verificationCriteria.length === 0) {
    violations.push('un plan doit déclarer au moins un critère de vérification global');
  }

  const orders = plan.steps.map((item) => item.order);
  const sortedOrders = [...orders].sort((left, right) => left - right);
  const attendus = Array.from({ length: plan.steps.length }, (_, index) => index + 1);
  if (
    sortedOrders.length !== attendus.length ||
    sortedOrders.some((value, index) => value !== attendus[index])
  ) {
    violations.push(
      `l'ordre des étapes doit être contigu à partir de 1 (reçu : ${JSON.stringify(sortedOrders)})`,
    );
  }
  const identifiants = plan.steps.map((item) => item.stepId);
  if (new Set(identifiants).size !== identifiants.length) {
    violations.push("identifiants d'étape dupliqués");
  }

  const parId = new Map<string, PlanStep>(plan.steps.map((item) => [item.stepId, item] as const));
  for (const item of plan.steps) {
    if (item.verification.length === 0) {
      violations.push(`étape ${item.stepId} sans critère de vérification`);
    }
    for (const dependance of item.dependsOn) {
      const cible = parId.get(dependance);
      if (cible === undefined) {
        violations.push(`étape ${item.stepId} dépend d'une étape inconnue : ${dependance}`);
      } else if (cible.order >= item.order) {
        violations.push(`étape ${item.stepId} dépend d'une étape non antérieure : ${dependance}`);
      }
    }
    if (ROLLBACK_REQUIRED.has(item.riskClass) && !item.rollback && !plan.rollback) {
      violations.push(`étape ${item.stepId} (${item.riskClass}) exige un rollback (étape ou plan)`);
    }
  }

  if (plan.version < 1) {
    violations.push("la version d'un plan commence à 1");
  }
  if (plan.version > 1 && !plan.supersedes) {
    violations.push("une révision doit déclarer le plan qu'elle remplace");
  }

  return violations;
}

/** Options de création d'un plan. */
export interface CreatePlanOptions {
  readonly requirements?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly risks?: readonly string[];
  readonly verificationCriteria?: readonly string[];
  readonly rollback?: string | null;
  readonly tenantId?: string | null;
  readonly projectId?: string | null;
  readonly taskId?: string | null;
  readonly intentId?: string | null;
}

/** Options de révision : un motif est obligatoire, tout le reste est facultatif. */
export interface RevisePlanOptions extends CreatePlanOptions {
  readonly reason: string;
  readonly objective?: string;
  readonly steps?: readonly PlanStep[];
}

/** Crée, valide et révise des plans. */
export class Planner {
  /** Crée un plan, numérote ses étapes dans l'ordre donné et le valide avant de le rendre. */
  create(objective: string, steps: readonly PlanStep[], options: CreatePlanOptions = {}): Plan {
    if (objective.trim() === '') {
      throw new PlanInvalidError('un plan sans objectif est refusé');
    }
    const numerotees = steps.map((item, index) => renumbered(item, index + 1));
    const plan = new Plan({
      objective: objective.trim(),
      steps: numerotees,
      status: PlanStatus.Draft,
      requirements: options.requirements ?? [],
      assumptions: options.assumptions ?? [],
      dependencies: options.dependencies ?? [],
      risks: options.risks ?? [],
      rollback: options.rollback ?? null,
      verificationCriteria: options.verificationCriteria ?? [],
      tenantId: options.tenantId ?? null,
      projectId: options.projectId ?? null,
      taskId: options.taskId ?? null,
      intentId: options.intentId ?? null,
    });
    plan.validate();
    return plan;
  }

  /** Passe un plan de `DRAFT` à `PROPOSED` (il n'est pas encore approuvé). */
  propose(plan: Plan): Plan {
    if (plan.status !== PlanStatus.Draft) {
      throw new PlanInvalidError('seul un plan à l’état DRAFT peut être proposé', {
        context: { status: plan.status },
      });
    }
    plan.status = PlanStatus.Proposed;
    plan.validate();
    return plan;
  }

  /**
   * Marque un plan comme approuvé — l'approbation humaine elle-même est un autre mécanisme.
   *
   * Cette méthode **consigne** une approbation déjà obtenue ; elle ne l'accorde pas. Le mécanisme
   * d'approbation (Human Gate) est enregistré séparément et rattaché par identifiant.
   */
  approve(plan: Plan): Plan {
    if (plan.status !== PlanStatus.Draft && plan.status !== PlanStatus.Proposed) {
      throw new PlanInvalidError('seul un plan DRAFT ou PROPOSED peut être approuvé', {
        context: { status: plan.status },
      });
    }
    plan.status = PlanStatus.Approved;
    plan.validate();
    return plan;
  }

  /**
   * Produit une nouvelle version d'un plan, sans réécrire la précédente.
   *
   * La version précédente est marquée `SUPERSEDED` (dans son propre enregistrement) et la nouvelle
   * la référence par `supersedes` : l'historique n'est jamais réécrit, seulement prolongé.
   */
  revise(plan: Plan, options: RevisePlanOptions): Plan {
    const reason = options.reason;
    if (reason.trim() === '') {
      throw new PlanInvalidError('une révision sans motif est refusée');
    }
    const nouveau = new Plan({
      objective: options.objective ?? plan.objective,
      steps: options.steps ?? plan.steps,
      version: plan.version + 1,
      supersedes: plan.planId,
      status: PlanStatus.Draft,
      requirements: options.requirements ?? plan.requirements,
      assumptions: options.assumptions ?? plan.assumptions,
      dependencies: options.dependencies ?? plan.dependencies,
      risks: [...(options.risks ?? plan.risks), `révision : ${reason.trim()}`],
      rollback: options.rollback ?? plan.rollback,
      verificationCriteria: options.verificationCriteria ?? plan.verificationCriteria,
      tenantId: plan.tenantId,
      projectId: plan.projectId,
      taskId: plan.taskId,
      intentId: plan.intentId,
    });
    nouveau.steps = nouveau.steps.map((item, index) => renumbered(item, index + 1));
    nouveau.validate();
    plan.status = PlanStatus.Superseded;
    return nouveau;
  }
}
