/**
 * runCodidev — exécute un cycle du Core CodiDev **côté serveur**.
 *
 * POURQUOI ce fichier n'importe rien de Next.js :
 * le cœur est une bibliothèque logicielle interne au paquet, pas un service et pas un endpoint.
 * Ce module ne fait que l'assembler à partir de l'environnement d'exécution, puis rendre un
 * résumé sérialisable. Le gestionnaire de route (`app/api/codidev/route.ts`) l'appelle ; c'est le
 * seul fichier de la fixture qui connaît une convention propre à Next.js.
 *
 * POURQUOI la configuration vient de l'environnement d'exécution :
 * la clé d'API ne doit jamais être écrite dans le code, ni dans un type, ni recopiée dans un
 * journal. Le cœur ne reçoit que le **nom** de la variable qui la porte
 * (`CODIDEV_LLM_API_KEY_ENV`) et la résout lui-même au moment de l'appel. Un appelant peut
 * fournir un `env` explicite (worker, serverless, tests) ; par défaut, c'est l'environnement du
 * processus. Aucune valeur de clé n'est lue ni manipulée ici.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IntegrityReport,
  OperationStatus,
  PlanStatus,
  PlanStep,
  RequestInit,
  RiskClass,
  RunResult,
  TaskState,
} from '../../src/index.js';
import { CodiDevCore } from '../../src/index.js';
import type { MockStep } from '../../src/llm/index.js';

/** Environnement d'exécution ; c'est là que vit la clé, jamais dans le code. */
export type CodidevEnv = Readonly<Record<string, string | undefined>>;

/** Nom du répertoire de journaux par défaut, relatif au processus serveur. */
export const DEFAULT_WORKSPACE_DIRNAME = '.codidev';

/**
 * Entrée d'un cycle : la demande, plus ce que l'appelant sait déjà.
 *
 * `env` est injectable pour que le même module serve en production (défaut `process.env`) et dans
 * les tests hors ligne, sans jamais recourir à une clé réelle.
 */
export interface RunCodidevInput {
  readonly text: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly projectId?: string;
  /** Signaux structurés (ex. `action: fix`, `scope: module auth`). */
  readonly hints?: Readonly<Record<string, string>>;
  /** Objectif du plan ; par défaut, l'énoncé de l'intention. */
  readonly objective?: string;
  /** Étapes fournies par l'appelant ; sinon le LLM en propose si `useLlmForPlan` est vrai. */
  readonly steps?: readonly PlanStep[];
  readonly useLlmForPlan?: boolean;
  /** Environnement d'exécution ; par défaut `process.env`. Aucune clé n'y est lue par ce module. */
  readonly env?: CodidevEnv;
  /** Scénario du provider simulé (provider `mock`) : réservé aux tests hors ligne. */
  readonly mockSteps?: readonly MockStep[];
}

/** Intention retenue, réduite à ce qui est utile à l'appelant. */
export interface CodidevSummaryIntent {
  readonly statement: string;
  readonly category: string;
  readonly confidence: number;
  readonly sources: readonly string[];
  readonly openQuestions: readonly string[];
}

/** Plan proposé, en lecture seule : l'approbation reste un acte humain hors de ce module. */
export interface CodidevSummaryPlan {
  readonly planId: string;
  readonly status: PlanStatus;
  readonly objective: string;
  readonly stepCount: number;
  readonly verificationCriteria: readonly string[];
  readonly requiresApproval: boolean;
}

/** Tâche engagée par le cycle. */
export interface CodidevSummaryTask {
  readonly taskId: string;
  readonly state: TaskState;
  readonly riskClass: RiskClass;
}

/** Intégrité des journaux, vérifiée avant de rendre le résumé. */
export interface CodidevSummaryIntegrity {
  readonly evidenceOk: boolean;
  readonly auditOk: boolean;
  readonly evidenceCount: number;
  readonly auditCount: number;
}

/** Résumé sérialisable d'un cycle — c'est ce que le gestionnaire de route renvoie en JSON. */
export interface CodidevSummary {
  readonly requestId: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly status: OperationStatus;
  readonly intent: CodidevSummaryIntent;
  readonly plan: CodidevSummaryPlan | null;
  readonly decisionId: string | null;
  readonly task: CodidevSummaryTask | null;
  readonly question: string | null;
  readonly notes: readonly string[];
  readonly integrity: CodidevSummaryIntegrity;
}

/** Répertoire de journaux : celui déclaré dans l'environnement, sinon un défaut local. */
function resolveWorkspaceDir(env: CodidevEnv): string {
  const declared = env.CODIDEV_WORKSPACE_DIR?.trim() ?? '';
  return declared === '' ? join(process.cwd(), DEFAULT_WORKSPACE_DIRNAME) : declared;
}

/** Projette le résultat du cycle en un objet fait de données simples, sûr à sérialiser en JSON. */
function summarize(
  result: RunResult,
  integrity: {
    readonly evidence: IntegrityReport;
    readonly audit: IntegrityReport;
  },
): CodidevSummary {
  const plan = result.plan;
  const task = result.task;
  return {
    requestId: result.requestId,
    tenantId: result.tenantId,
    actor: result.actor,
    status: result.status,
    intent: {
      statement: result.intent.statement,
      category: result.intent.category,
      confidence: result.intent.confidence,
      sources: [...result.intent.sources],
      openQuestions: [...result.intent.openQuestions],
    },
    plan:
      plan === null
        ? null
        : {
            planId: plan.planId,
            status: plan.status,
            objective: plan.objective,
            stepCount: plan.steps.length,
            verificationCriteria: [...plan.verificationCriteria],
            requiresApproval: plan.requiresApproval,
          },
    decisionId: result.decisionId,
    task:
      task === null ? null : { taskId: task.taskId, state: task.state, riskClass: task.riskClass },
    question: result.question,
    notes: [...result.notes],
    integrity: {
      evidenceOk: integrity.evidence.ok,
      auditOk: integrity.audit.ok,
      evidenceCount: integrity.evidence.count,
      auditCount: integrity.audit.count,
    },
  };
}

/**
 * Instancie le cœur puis exécute un cycle complet.
 *
 * Rien n'est exécuté par ce cycle : le cœur s'arrête à la frontière d'exécution et rend
 * `NOT_EXECUTED` avec un plan `PROPOSED`. Présenter autre chose serait mentir sur ce qui a
 * réellement eu lieu.
 */
export async function runCodidev(input: RunCodidevInput): Promise<CodidevSummary> {
  const env = input.env ?? process.env;
  const workspaceDir = resolveWorkspaceDir(env);
  // Le magasin de preuves crée son fichier mais pas le répertoire racine : on le prépare ici pour
  // qu'un premier lancement sur un serveur neuf ne dépende pas d'un `mkdir` humain.
  mkdirSync(workspaceDir, { recursive: true });

  const core = CodiDevCore.create({
    workspaceDir,
    env,
    // `mockSteps` n'a de sens qu'avec le provider simulé ; on ne le transmet que s'il est fourni,
    // afin de ne jamais passer `undefined` à un champ optionnel (exactOptionalPropertyTypes).
    ...(input.mockSteps === undefined ? {} : { mockSteps: input.mockSteps }),
  });

  const request: RequestInit = {
    text: input.text,
    tenantId: input.tenantId,
    actor: input.actor,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.hints === undefined ? {} : { hints: input.hints }),
  };

  const result = await core.run(request, {
    ...(input.steps === undefined ? {} : { steps: input.steps }),
    ...(input.useLlmForPlan === undefined ? {} : { useLlmForPlan: input.useLlmForPlan }),
    ...(input.objective === undefined ? {} : { objective: input.objective }),
  });

  // On vérifie l'intégrité avant de rendre le résumé : tant que la chaîne n'est pas prouvée
  // intacte, l'appelant ne doit pas pouvoir présenter ce cycle comme fiable.
  const integrity = await core.integrity();
  return summarize(result, integrity);
}
