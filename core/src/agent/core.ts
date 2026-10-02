/**
 * Agent Core — le cycle agentique.
 *
 *     comprendre → planifier → décider → engager une tâche
 *
 * Frontière explicite de cette phase : **le cycle prépare, il n'exécute pas.** Aucun outil n'est
 * appelé, aucune action n'est revendiquée, et le statut rendu est `NOT_EXECUTED`. C'est ce qui
 * permet d'utiliser le cœur sans jamais présenter une intention comme un résultat.
 *
 * Le LLM intervient là où le raisonnement génératif est nécessaire — classer une demande, proposer
 * des étapes — et **jamais** comme autorité :
 *
 *   - une classification hors vocabulaire laisse la demande indéterminée (question ouverte) ;
 *   - des étapes proposées passent par les invariants du Planner ; si elles les violent, le plan
 *     est refusé et aucune tâche n'est engagée ;
 *   - la politique garde le dernier mot : un refus interdit toute sélection ;
 *   - une action engageante impose un Human Gate, même autorisée.
 *
 * Le contrôle du cycle reste au cœur : le modèle propose, le cœur dispose.
 */

import type { AuditLedger } from '../audit.js';
import {
  type ContextBundle,
  ContextEngine,
  ContextLayer,
  makeItem,
  TrustLevel,
} from '../context/engine.js';
import { DecisionEngine, type Option, option, PolicyVerdict } from '../decision/engine.js';
import { PlanInvalidError } from '../errors.js';
import type { EvidenceStore } from '../evidence.js';
import type { LLMProvider } from '../llm/types.js';
import { LLMRole } from '../llm/types.js';
import {
  type CreatePlanOptions,
  type Plan,
  Planner,
  PlanStatus,
  type PlanStep,
  step,
} from '../planner/planner.js';
import { OperationStatus, RiskClass, requiresHumanApproval, TaskState } from '../statuses.js';
import type { Task } from '../task/engine.js';
import { TaskEngine } from '../task/engine.js';
import { analyzeSignals, classifyWithLLM, type IntentRecord } from './intent.js';
import type { Request } from './request.js';

/** Mention portée dans le plan et dans les notes : ce qui n'a pas été fait ne se déduit pas. */
export const EXECUTION_BOUNDARY =
  "frontière d'exécution : aucune action n'a été exécutée — l'exécution contrôlée n'est pas " +
  'construite. Ce plan est une proposition révisable, pas un compte rendu.';

/** Schéma de la sortie attendue du modèle lorsqu'il propose des étapes. */
export const PLAN_STEPS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'expected_output', 'verification'],
        properties: {
          description: { type: 'string', minLength: 1 },
          expected_output: { type: 'string', minLength: 1 },
          verification: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          risk_class: { type: 'string' },
          rollback: { type: 'string' },
        },
      },
    },
  },
};

const PLAN_SYSTEM_PROMPT =
  'Tu proposes des étapes de plan pour un travail logiciel. Chaque étape doit porter un résultat ' +
  'attendu et au moins un critère de vérification observable. Tu ne proposes aucune commande à ' +
  'exécuter et tu ne déclares jamais un travail terminé : tu proposes des étapes.';

/**
 * Ordre de gravité des classes de risque, déclaré par le cœur.
 *
 * Il sert à dériver la classe d'une action à partir de ses étapes : prendre la plus grave est la
 * seule dérivation conservatrice — sous-estimer le risque d'une action reviendrait à contourner
 * le Human Gate.
 */
const RISK_SEVERITY_ORDER: readonly RiskClass[] = [
  RiskClass.Read,
  RiskClass.LowWrite,
  RiskClass.Write,
  RiskClass.SensitiveWrite,
  RiskClass.ExternalSideEffect,
  RiskClass.Destructive,
  RiskClass.Deployment,
  RiskClass.SecuritySensitive,
];

/** Classe de risque la plus grave parmi les étapes ; `READ` si le plan n'a aucune étape risquée. */
function planRiskClass(steps: readonly PlanStep[]): RiskClass {
  let highest: RiskClass = RiskClass.Read;
  for (const item of steps) {
    if (RISK_SEVERITY_ORDER.indexOf(item.riskClass) > RISK_SEVERITY_ORDER.indexOf(highest)) {
      highest = item.riskClass;
    }
  }
  return highest;
}

/** Un plan est réversible si chaque étape risquée déclare un rollback. */
function planIsReversible(steps: readonly PlanStep[]): boolean {
  return steps.every(
    (item) => !requiresHumanApproval(item.riskClass) || (item.rollback ?? '') !== '',
  );
}

const RISK_BY_NAME: Readonly<Record<string, RiskClass>> = {
  READ: RiskClass.Read,
  LOW_WRITE: RiskClass.LowWrite,
  WRITE: RiskClass.Write,
  SENSITIVE_WRITE: RiskClass.SensitiveWrite,
  DESTRUCTIVE: RiskClass.Destructive,
  EXTERNAL_SIDE_EFFECT: RiskClass.ExternalSideEffect,
  DEPLOYMENT: RiskClass.Deployment,
  SECURITY_SENSITIVE: RiskClass.SecuritySensitive,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Résultat de l'analyse : intention établie et contexte isolé. */
export interface Analysis {
  readonly request: Request;
  readonly intent: IntentRecord;
  readonly bundle: ContextBundle;
  readonly contextText: string;
}

/** Options d'un cycle complet. */
export interface RunOptions {
  /** Étapes fournies par l'appelant. Sans étapes, le LLM peut en proposer si `useLlmForPlan`. */
  readonly steps?: readonly PlanStep[];
  readonly planOptions?: CreatePlanOptions;
  /** Objectif du plan ; par défaut l'énoncé de l'intention. */
  readonly objective?: string;
  /** Options examinées par le Decision Engine. */
  readonly options?: readonly Option[];
  /** Verdict de politique. Par défaut : autorisation explicite, aucune obligation. */
  readonly policy?: PolicyVerdict;
  readonly verificationPlan?: readonly string[];
  /** Autorise le LLM à proposer des étapes lorsque l'appelant n'en fournit pas. */
  readonly useLlmForPlan?: boolean;
}

/** Résultat d'un cycle : ce qui a été compris, proposé et décidé — et rien de plus. */
export interface RunResult {
  readonly requestId: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly status: OperationStatus;
  readonly intent: IntentRecord;
  readonly plan: Plan | null;
  readonly decisionId: string | null;
  readonly task: Task | null;
  readonly question: string | null;
  readonly contextLayers: number;
  readonly notes: readonly string[];
}

export interface AgentCoreOptions {
  readonly planner?: Planner;
  readonly decisionEngine?: DecisionEngine;
  readonly taskEngine?: TaskEngine;
  readonly contextEngine?: ContextEngine;
  readonly evidence?: EvidenceStore;
  readonly audit?: AuditLedger;
  /** Facultatif : sans provider, le cycle reste entièrement déterministe. */
  readonly llm?: LLMProvider;
  readonly defaultActor?: string;
}

/**
 * Cycle agentique du cœur.
 *
 * Toutes les briques sont injectables et facultatives : le cœur fonctionne sans LLM, sans journal
 * et sans contexte préexistant. Aucune brique n'est construite en dur, ce qui permet de les
 * remplacer sans modifier le cycle.
 */
export class AgentCore {
  readonly planner: Planner;
  readonly decisionEngine: DecisionEngine;
  readonly taskEngine: TaskEngine;
  readonly contextEngine: ContextEngine;
  readonly evidence: EvidenceStore | undefined;
  readonly audit: AuditLedger | undefined;
  readonly llm: LLMProvider | undefined;
  readonly defaultActor: string;

  constructor(options: AgentCoreOptions = {}) {
    this.planner = options.planner ?? new Planner();
    this.decisionEngine = options.decisionEngine ?? new DecisionEngine();
    this.taskEngine = options.taskEngine ?? new TaskEngine();
    this.contextEngine = options.contextEngine ?? new ContextEngine();
    this.evidence = options.evidence;
    this.audit = options.audit;
    this.llm = options.llm;
    this.defaultActor = options.defaultActor ?? 'codidev-core';
  }

  /**
   * Établit l'intention et assemble un contexte isolé.
   *
   * Le LLM n'est sollicité que si aucun signal explicite n'a permis de conclure. Son échec est
   * absorbé volontairement : un fournisseur indisponible ne doit pas transformer une demande
   * compréhensible en panne — il la laisse indéterminée, et le cœur posera une question.
   */
  async analyze(request: Request): Promise<Analysis> {
    let intent = analyzeSignals(request);
    if (!intent.isDetermined && this.llm !== undefined) {
      try {
        intent = await classifyWithLLM(request, this.llm);
      } catch {
        intent = analyzeSignals(request);
      }
    }
    const bundle = this.contextEngine.build({
      tenantId: request.tenantId,
      projectId: request.projectId,
      requestId: request.requestId,
    });
    bundle.add(
      makeItem({
        layer: ContextLayer.Task,
        trust: TrustLevel.Unverified,
        source: `request:${request.requestId}`,
        content: request.text,
        tenantId: request.tenantId,
        projectId: request.projectId,
      }),
    );
    const contextText = bundle.render();
    await this.recordAudit({
      actor: request.actor,
      action: 'intent.analyze',
      resource: `request:${request.requestId}`,
      riskClass: RiskClass.Read,
      result: intent.isDetermined ? OperationStatus.Executed : OperationStatus.WaitingForUser,
      tenantId: request.tenantId,
      ...(request.projectId === null ? {} : { projectId: request.projectId }),
    });
    return { request: request, intent, bundle, contextText };
  }

  /**
   * Demande au LLM de proposer des étapes, puis les **valide**.
   *
   * Les étapes proposées ne deviennent pas un plan par la seule volonté du modèle : elles passent
   * par `Planner.create`, donc par les invariants (ordre, dépendances, critère de vérification par
   * étape, rollback obligatoire pour une étape destructive). Une proposition qui les viole est
   * refusée — et l'erreur remonte, elle n'est pas absorbée.
   */
  async proposeSteps(objective: string, analysis: Analysis): Promise<PlanStep[]> {
    if (this.llm === undefined) {
      throw new PlanInvalidError('aucun provider LLM configuré : étapes non proposables', {
        context: { objective },
      });
    }
    const response = await this.llm.generate({
      requestId: analysis.request.requestId,
      system: PLAN_SYSTEM_PROMPT,
      context: analysis.contextText,
      messages: [{ role: LLMRole.User, content: objective }],
      structuredSchema: PLAN_STEPS_SCHEMA,
      temperature: 0,
    });
    const payload = response.structured;
    if (!isRecord(payload) || !Array.isArray(payload.steps) || payload.steps.length === 0) {
      throw new PlanInvalidError('le modèle n’a proposé aucune étape exploitable', {
        context: { requestId: analysis.request.requestId },
      });
    }
    const steps: PlanStep[] = [];
    for (const [index, raw] of payload.steps.entries()) {
      if (!isRecord(raw)) {
        throw new PlanInvalidError(`étape ${index + 1} illisible : structure attendue absente`);
      }
      const description = raw.description;
      const expectedOutput = raw.expected_output;
      const verification = raw.verification;
      if (typeof description !== 'string' || description.trim() === '') {
        throw new PlanInvalidError(`étape ${index + 1} sans description`);
      }
      if (typeof expectedOutput !== 'string' || expectedOutput.trim() === '') {
        throw new PlanInvalidError(`étape ${index + 1} sans résultat attendu`);
      }
      if (
        !Array.isArray(verification) ||
        verification.length === 0 ||
        !verification.every((item) => typeof item === 'string' && item.trim() !== '')
      ) {
        throw new PlanInvalidError(`étape ${index + 1} sans critère de vérification`);
      }
      const declaredRisk =
        typeof raw.risk_class === 'string' ? RISK_BY_NAME[raw.risk_class.toUpperCase()] : undefined;
      steps.push(
        step(description, {
          expectedOutput,
          verification: verification as string[],
          ...(declaredRisk === undefined ? {} : { riskClass: declaredRisk }),
          ...(typeof raw.rollback === 'string' ? { rollback: raw.rollback } : {}),
        }),
      );
    }
    return steps;
  }

  /**
   * Crée un plan validé à partir d'étapes (fournies, ou proposées par le modèle puis validées).
   *
   * L'appelant ne peut pas choisir l'identifiant d'intention, le tenant ni le projet : ils sont
   * repris de l'analyse. Un plan ne peut donc pas être rattaché à un autre tenant que celui de la
   * demande, même par erreur.
   */
  plan(
    analysis: Analysis,
    steps: readonly PlanStep[],
    options: CreatePlanOptions = {},
    objective?: string,
  ): Plan {
    // Le contrat exige des critères de vérification au niveau du plan, pas seulement par étape.
    // Ils sont **dérivés** des critères d'étape — jamais inventés : si aucune étape n'est vérifiable,
    // le plan n'a pas de critère, et il est refusé plutôt que déclaré vérifiable sans moyen de le
    // vérifier.
    const derivedCriteria = steps.flatMap((item) =>
      item.verification.map((criterion) => `étape ${item.order} : ${criterion}`),
    );
    const criteria = options.verificationCriteria ?? derivedCriteria;
    const created = this.planner.create(objective ?? analysis.intent.statement, steps, {
      ...options,
      verificationCriteria: criteria,
      intentId: analysis.intent.intentId,
      tenantId: analysis.request.tenantId,
      projectId: analysis.request.projectId,
    });
    // Un plan créé est un brouillon ; dans le cycle, il est **proposé** à l'exécution. Ce passage
    // est explicite parce qu'il engage : on ne confond pas « écrit » et « proposé ». Le plan n'est
    // en revanche jamais approuvé par le cœur lui-même — l'approbation est un acte humain.
    return this.planner.propose(created);
  }

  /** Enregistre une décision : politique, options examinées, plan de vérification. */
  decide(
    analysis: Analysis,
    plan: Plan,
    options: readonly Option[],
    policy: PolicyVerdict,
    verificationPlan: readonly string[],
  ) {
    return this.decisionEngine.decide({
      intent: analysis.intent.statement,
      options,
      policy,
      verificationPlan,
      planId: plan.planId,
      tenantId: analysis.request.tenantId,
      projectId: analysis.request.projectId,
      sources: [...analysis.intent.sources],
    });
  }

  /** Engage une tâche à l'état `PROPOSED`, reliée au plan et à la décision. */
  async openTask(
    request: Request,
    plan: Plan,
    decisionId: string | null,
    riskClass: RiskClass,
  ): Promise<Task> {
    return this.taskEngine.open(plan.objective, {
      tenantId: request.tenantId,
      projectId: request.projectId,
      planId: plan.planId,
      decisionId,
      riskClass,
      actor: request.actor,
    });
  }

  /**
   * Cycle complet.
   *
   * Statuts possibles, et ce qu'ils signifient réellement :
   *
   *   - `WAITING_FOR_USER` — soit l'intention n'est pas établie (question ouverte, aucune tâche),
   *     soit une approbation humaine est requise (tâche en attente) ;
   *   - `BLOCKED` — la politique a refusé : aucune option retenue, aucune tâche engagée ;
   *   - `NOT_EXECUTED` — le plan est prêt, la tâche est `PROPOSED`. Rien n'a été exécuté.
   *
   * Aucun chemin ne rend `EXECUTED` ni `VERIFIED` : cette phase ne dispose pas d'exécution.
   */
  async run(request: Request, options: RunOptions = {}): Promise<RunResult> {
    const notes: string[] = [];
    const analysis = await this.analyze(request);

    if (!analysis.intent.isDetermined) {
      const question = analysis.intent.openQuestions[0] ?? null;
      notes.push('intention non établie : aucune planification, aucune tâche engagée');
      await this.recordEvidence(request, 'core.run', OperationStatus.WaitingForUser, {
        warnings: notes,
      });
      return {
        requestId: request.requestId,
        tenantId: request.tenantId,
        actor: request.actor,
        status: OperationStatus.WaitingForUser,
        intent: analysis.intent,
        plan: null,
        decisionId: null,
        task: null,
        question,
        contextLayers: analysis.bundle.items.length,
        notes,
      };
    }

    const objective = options.objective ?? analysis.intent.statement;
    let steps = options.steps ?? [];
    if (steps.length === 0 && options.useLlmForPlan === true) {
      steps = await this.proposeSteps(objective, analysis);
      notes.push('étapes proposées par le modèle, puis validées par les invariants du plan');
    }
    const plan = this.plan(analysis, steps, { ...(options.planOptions ?? {}) }, objective);
    await this.recordAudit({
      actor: request.actor,
      action: 'plan.propose',
      resource: `plan:${plan.planId}`,
      riskClass: RiskClass.Read,
      result: OperationStatus.Executed,
      tenantId: request.tenantId,
      ...(request.projectId === null ? {} : { projectId: request.projectId }),
    });

    const policy =
      options.policy ??
      PolicyVerdict.allow({ policyId: 'default-allow@v1', reason: 'aucune politique restrictive' });
    // Une décision sans option examinée n'est pas une décision. Si l'appelant n'en fournit
    // aucune, le cœur dérive l'action par défaut — exécuter ce plan — et en tire la classe de
    // risque et la réversibilité **des étapes réelles**, jamais d'une estimation.
    const examined =
      options.options !== undefined && options.options.length > 0
        ? options.options
        : [
            option(`exécuter le plan : ${plan.objective}`, {
              riskClass: planRiskClass(plan.steps),
              reversible: planIsReversible(plan.steps),
              expectedOutcome: plan.objective,
            }),
          ];
    const decision = this.decide(
      analysis,
      plan,
      examined,
      policy,
      options.verificationPlan ?? plan.verificationCriteria,
    );
    await this.recordAudit({
      actor: request.actor,
      action: 'decision.record',
      resource: `decision:${decision.decisionId}`,
      riskClass: RiskClass.Read,
      result: OperationStatus.Executed,
      tenantId: request.tenantId,
      policyDecisionId: decision.decisionId,
      ...(request.projectId === null ? {} : { projectId: request.projectId }),
    });

    if (decision.selectedOptionId === null) {
      notes.push('politique : aucune option retenue — aucune tâche engagée');
      await this.recordEvidence(request, 'core.run', OperationStatus.Blocked, { warnings: notes });
      return {
        requestId: request.requestId,
        tenantId: request.tenantId,
        actor: request.actor,
        status: OperationStatus.Blocked,
        intent: analysis.intent,
        plan,
        decisionId: decision.decisionId,
        task: null,
        question: null,
        contextLayers: analysis.bundle.items.length,
        notes,
      };
    }

    // La classe de risque de l'option retenue gouverne la tâche : elle détermine si l'exécution
    // exigera une approbation, et non l'inverse.
    const selected = decision.options.find((item) => item.selected) ?? null;
    const riskClass = selected?.riskClass ?? RiskClass.Read;
    let task = await this.openTask(request, plan, decision.decisionId, riskClass);
    // `open()` rend une tâche à l'état DRAFT. Le parcours canonique impose de nommer ce qui s'est
    // réellement passé : l'intention a été analysée, puis un plan a été proposé et arbitré. Sauter
    // directement à PROPOSED ferait mentir l'historique.
    task = await this.taskEngine.transition(task, TaskState.Analyzing, {
      reason: 'intention établie et contexte assemblé',
      actor: request.actor,
    });
    task = await this.taskEngine.transition(task, TaskState.Proposed, {
      reason: 'plan proposé et décision enregistrée',
      actor: request.actor,
    });

    if (decision.obligations.length > 0) {
      task = await this.taskEngine.transition(task, TaskState.WaitingForUser, {
        reason: `obligation(s) : ${decision.obligations.join(', ')}`,
        actor: request.actor,
      });
      notes.push(EXECUTION_BOUNDARY, 'approbation humaine requise avant toute exécution');
      await this.recordEvidence(request, 'core.run', OperationStatus.WaitingForUser, {
        warnings: notes,
      });
      return {
        requestId: request.requestId,
        tenantId: request.tenantId,
        actor: request.actor,
        status: OperationStatus.WaitingForUser,
        intent: analysis.intent,
        plan,
        decisionId: decision.decisionId,
        task,
        question: null,
        contextLayers: analysis.bundle.items.length,
        notes,
      };
    }

    notes.push(EXECUTION_BOUNDARY);
    await this.recordEvidence(request, 'core.run', OperationStatus.NotExecuted, {
      warnings: notes,
      ...(task.taskId === '' ? {} : { resource: `task:${task.taskId}` }),
    });
    return {
      requestId: request.requestId,
      tenantId: request.tenantId,
      actor: request.actor,
      status: OperationStatus.NotExecuted,
      intent: analysis.intent,
      plan,
      decisionId: decision.decisionId,
      task,
      question: null,
      contextLayers: analysis.bundle.items.length,
      notes,
    };
  }

  /** Consigne une action dans l'audit, lorsque le journal est fourni. */
  private async recordAudit(input: {
    readonly actor: string;
    readonly action: string;
    readonly resource: string;
    readonly riskClass: RiskClass;
    readonly result: OperationStatus;
    readonly tenantId: string;
    readonly projectId?: string;
    readonly policyDecisionId?: string;
  }): Promise<void> {
    if (this.audit === undefined) return;
    await this.audit.recordAction({
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      riskClass: input.riskClass,
      result: input.result,
      tenantId: input.tenantId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.policyDecisionId === undefined ? {} : { policyDecisionId: input.policyDecisionId }),
    });
  }

  /** Consigne une preuve du cycle, lorsque le magasin est fourni. */
  private async recordEvidence(
    request: Request,
    operation: string,
    status: OperationStatus,
    options: {
      readonly warnings?: readonly string[];
      readonly resource?: string;
    } = {},
  ): Promise<void> {
    if (this.evidence === undefined) return;
    await this.evidence.record(operation, status, {
      actor: request.actor,
      tenantId: request.tenantId,
      ...(request.projectId === null ? {} : { projectId: request.projectId }),
      ...(options.warnings === undefined ? {} : { warnings: options.warnings }),
      ...(options.resource === undefined ? {} : { resource: options.resource }),
    });
  }
}

export { PlanStatus };
