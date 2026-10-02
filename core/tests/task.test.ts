/**
 * Tests du Task Engine : transitions, vérification obligatoire, observabilité.
 * Invariants couverts : I-11, I-12, I-13, I-14.
 *
 * Les journaux sont des doubles de test conformes aux interfaces structurelles exportées par le
 * module : ces tests ne dépendent donc pas du magasin de preuves ni du registre d'audit réels.
 */

import { describe, expect, it } from 'vitest';

import { isValid } from '../src/contracts.js';
import { TaskTransitionError, VerificationRequiredError } from '../src/errors.js';
import { OperationStatus, RiskClass, TaskState } from '../src/statuses.js';
import type {
  AuditActionRecord,
  EvidenceRecordOptions,
  ValidationOutcome,
} from '../src/task/engine.js';
import { Task, TaskEngine, TaskEvent } from '../src/task/engine.js';

/** Entrée capturée par le double du journal de preuves. */
interface EntreePreuve {
  readonly operation: string;
  readonly status: OperationStatus;
  readonly options: EvidenceRecordOptions;
  readonly evidence_id: string;
}

/** Double minimal d'un journal de preuves : il enregistre et rend un identifiant. */
class FauxJournalPreuves {
  readonly entrees: EntreePreuve[] = [];

  async record(
    operation: string,
    status: OperationStatus,
    options: EvidenceRecordOptions,
  ): Promise<unknown> {
    const evidence_id = `ev_test${String(this.entrees.length + 1)}`;
    this.entrees.push({ operation, status, options, evidence_id });
    return { evidence_id };
  }

  count(): number {
    return this.entrees.length;
  }
}

/** Double minimal d'un journal d'audit : il enregistre les actions tel quel. */
class FauxJournalAudit {
  readonly actions: AuditActionRecord[] = [];

  async recordAction(record: AuditActionRecord): Promise<unknown> {
    this.actions.push(record);
    return { audit_id: `aud${String(this.actions.length)}` };
  }

  count(): number {
    return this.actions.length;
  }
}

function verificationReussie(): ValidationOutcome {
  return { criteria: ['les tests passent'], performed: true, passed: true };
}

/** Déroule le chemin nominal jusqu'à `VERIFYING`, sans injecter de vérification. */
async function jusquaVerifying(moteur: TaskEngine): Promise<Task> {
  const task = await moteur.open('corriger le module');
  await moteur.transition(task, TaskState.Analyzing);
  await moteur.transition(task, TaskState.Proposed);
  await moteur.transition(task, TaskState.InProgress);
  await moteur.transition(task, TaskState.Executed);
  await moteur.transition(task, TaskState.Verifying);
  return task;
}

describe('TaskEngine — transitions et vérification', () => {
  it('ouvre une tâche en brouillon et consigne sa création', async () => {
    const task = await new TaskEngine().open('corriger le module', { tenantId: 'tenant-a' });

    expect(task.state).toBe(TaskState.Draft);
    expect(task.history).toHaveLength(1);
    expect(task.history[0]?.fromState).toBeNull();
    expect(task.history[0]?.toState).toBe(TaskState.Draft);
  });

  it('refuse une tâche sans objectif', async () => {
    await expect(new TaskEngine().open('   ')).rejects.toThrow(TaskTransitionError);
  });

  it('I-11 : refuse une transition non autorisée', async () => {
    const moteur = new TaskEngine();
    const task = await moteur.open('corriger le module');

    await expect(moteur.transition(task, TaskState.Completed)).rejects.toThrow(TaskTransitionError);
    expect(task.state).toBe(TaskState.Draft);
  });

  it('déroule le chemin nominal jusqu’à la vérification', async () => {
    const moteur = new TaskEngine();
    const task = await moteur.open('corriger le module');
    await moteur.transition(task, TaskState.Analyzing);
    await moteur.transition(task, TaskState.Proposed);
    await moteur.transition(task, TaskState.InProgress);
    await moteur.transition(task, TaskState.Executed);
    await moteur.transition(task, TaskState.Verifying);
    await moteur.transition(task, TaskState.Verified, { validation: verificationReussie() });
    await moteur.transition(task, TaskState.Ready);
    await moteur.transition(task, TaskState.Completed);

    expect(task.state).toBe(TaskState.Completed);
    expect(task.isTerminal).toBe(true);
  });

  it('I-12 : refuse VERIFIED sans vérification fournie', async () => {
    const moteur = new TaskEngine();
    const task = await jusquaVerifying(moteur);

    await expect(moteur.transition(task, TaskState.Verified)).rejects.toThrow(
      VerificationRequiredError,
    );
    expect(task.state).toBe(TaskState.Verifying);
  });

  it('I-12 : refuse VERIFIED quand la vérification a échoué', async () => {
    const moteur = new TaskEngine();
    const task = await jusquaVerifying(moteur);
    const echec: ValidationOutcome = {
      criteria: ['les tests passent'],
      performed: true,
      passed: false,
    };

    await expect(
      moteur.transition(task, TaskState.Verified, { validation: echec }),
    ).rejects.toThrow(VerificationRequiredError);
  });

  it('I-12 : refuse VERIFIED quand la vérification n’a pas été exécutée', async () => {
    const moteur = new TaskEngine();
    const task = await jusquaVerifying(moteur);
    const nonExecutee: ValidationOutcome = {
      criteria: ['les tests passent'],
      performed: false,
      passed: false,
    };

    await expect(
      moteur.transition(task, TaskState.Verified, { validation: nonExecutee }),
    ).rejects.toThrow(VerificationRequiredError);
  });

  it('I-13 : refuse COMPLETED si la tâche n’est jamais passée par VERIFIED', async () => {
    // Tâche fabriquée à l'état READY dont l'historique ne contient aucun VERIFIED : le contrôle
    // redondant doit refuser, même si la table autorise READY -> COMPLETED.
    const task = new Task({
      objective: 'tâche héritée',
      state: TaskState.Ready,
      history: [
        new TaskEvent({
          seq: 0,
          fromState: null,
          toState: TaskState.Draft,
          at: '2026-10-02T20:00:00Z',
          reason: 'création de la tâche',
          actor: 'test',
        }),
      ],
    });

    await expect(new TaskEngine().transition(task, TaskState.Completed)).rejects.toThrow(
      VerificationRequiredError,
    );
  });

  it('une tâche terminale n’évolue plus', async () => {
    const moteur = new TaskEngine();
    const task = await moteur.open('corriger le module');
    await moteur.transition(task, TaskState.Cancelled, { reason: 'annulée par l’utilisateur' });

    await expect(moteur.transition(task, TaskState.InProgress)).rejects.toThrow(
      TaskTransitionError,
    );
  });

  it('rend l’attente d’approbation observable', async () => {
    const moteur = new TaskEngine();
    const task = await moteur.open('déployer', { riskClass: RiskClass.Deployment });
    await moteur.transition(task, TaskState.Analyzing);
    await moteur.transition(task, TaskState.Proposed);
    await moteur.transition(task, TaskState.WaitingForUser, { reason: 'approbation requise' });

    expect(task.state).toBe(TaskState.WaitingForUser);
    expect(task.history.at(-1)?.reason).toBe('approbation requise');
  });

  it('rend le blocage par la politique observable', async () => {
    const moteur = new TaskEngine();
    const task = await moteur.open('modifier un fichier interdit');
    await moteur.transition(task, TaskState.Analyzing);
    await moteur.transition(task, TaskState.Blocked, { reason: 'hors périmètre' });

    expect(task.state).toBe(TaskState.Blocked);
  });

  it('expose un historique séquencé, d’où, vers quoi, quand et pourquoi', async () => {
    const moteur = new TaskEngine();
    const task = await moteur.open('corriger le module');
    await moteur.transition(task, TaskState.Analyzing);
    await moteur.transition(task, TaskState.Proposed);

    expect(task.history.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(task.history.map((event) => event.toState)).toEqual([
      TaskState.Draft,
      TaskState.Analyzing,
      TaskState.Proposed,
    ]);
    expect(task.history.map((event) => event.fromState)).toEqual([
      null,
      TaskState.Draft,
      TaskState.Analyzing,
    ]);
    expect(task.history.every((event) => event.at.length > 0)).toBe(true);
  });

  it('I-14 : consigne chaque transition, création comprise, dans les preuves et l’audit', async () => {
    const preuves = new FauxJournalPreuves();
    const audit = new FauxJournalAudit();
    const moteur = new TaskEngine({ evidence: preuves, audit });
    const task = await moteur.open('corriger le module', { tenantId: 'tenant-a' });
    await moteur.transition(task, TaskState.Analyzing);
    await moteur.transition(task, TaskState.Proposed);

    expect(preuves.count()).toBe(3);
    expect(audit.count()).toBe(3);

    const premiere = preuves.entrees[0];
    expect(premiere?.operation).toBe('task.open:DRAFT');
    const seconde = preuves.entrees[1];
    expect(seconde?.status).toBe(OperationStatus.Executed);
    expect(seconde?.options.resource).toBe(`task:${task.taskId}`);
    expect(seconde?.options.externalIds).toEqual({ task_id: task.taskId });

    const premiereAction = audit.actions[0];
    expect(premiereAction?.action).toBe('task.open:DRAFT');
    expect(premiereAction?.tenantId).toBe('tenant-a');
    // L'audit chaîne l'identifiant de preuve : la preuve et l'action se répondent.
    expect(premiereAction?.evidenceId).toBe(premiere?.evidence_id);
  });

  it('I-14 : consigne l’attente avec le statut réel WAITING_FOR_USER', async () => {
    const preuves = new FauxJournalPreuves();
    const moteur = new TaskEngine({ evidence: preuves });
    const task = await moteur.open('déployer');
    await moteur.transition(task, TaskState.Analyzing);
    await moteur.transition(task, TaskState.Proposed);
    await moteur.transition(task, TaskState.WaitingForUser);

    expect(preuves.entrees.at(-1)?.status).toBe(OperationStatus.WaitingForUser);
  });

  it('I-14 : consigne le blocage avec le statut réel BLOCKED', async () => {
    const preuves = new FauxJournalPreuves();
    const moteur = new TaskEngine({ evidence: preuves });
    const task = await moteur.open('modifier un fichier interdit');
    await moteur.transition(task, TaskState.Analyzing);
    await moteur.transition(task, TaskState.Blocked, { reason: 'hors périmètre' });

    expect(preuves.entrees.at(-1)?.status).toBe(OperationStatus.Blocked);
    expect(preuves.entrees.at(-1)?.options.warnings).toEqual(['hors périmètre']);
  });

  it('une tâche conforme est valide au contrat', async () => {
    const task = await new TaskEngine().open('corriger le module', { tenantId: 'tenant-a' });
    expect(isValid('task', task.toDict())).toBe(true);
  });
});
