/**
 * Tests de l'Agent Core : demande, intention, cycle, et **frontière d'autorité du LLM**.
 * Invariants couverts : I-34 (pas de devinette), I-35 (aucune exécution revendiquée), I-36.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { RequestInit } from '../src/agent/index.js';
import {
  AgentCore,
  analyzeSignals,
  classifyWithLLM,
  EXECUTION_BOUNDARY,
  INTENT_CATEGORIES,
  IntentCategory,
  IntentRecord,
  MAX_INFERRED_CONFIDENCE,
  QUESTION_SANS_SIGNAL,
  Request,
  RequestInvalidError,
} from '../src/agent/index.js';
import { AuditLedger } from '../src/audit.js';
import { option, PolicyVerdict } from '../src/decision/engine.js';
import { PlanInvalidError } from '../src/errors.js';
import { EvidenceStore } from '../src/evidence.js';
import { MockLLMProvider } from '../src/llm/index.js';
import { step } from '../src/planner/planner.js';
import { OperationStatus, RiskClass, TaskState } from '../src/statuses.js';

function demande(overrides: Partial<RequestInit> = {}): Request {
  return new Request({
    text: 'Corriger le module de facturation',
    tenantId: 'tenant-a',
    actor: 'user-1',
    ...overrides,
  });
}

function etapesValides() {
  return [
    step('Lire le module', {
      expectedOutput: 'Compréhension du module',
      verification: ['lecture'],
    }),
    step('Corriger le défaut', {
      expectedOutput: 'Défaut corrigé',
      verification: ['test unitaire vert'],
      dependsOn: [],
    }),
  ];
}

function journaux() {
  const racine = mkdtempSync(join(tmpdir(), 'codidev-agent-'));
  return {
    evidence: new EvidenceStore(join(racine, 'preuves.jsonl')),
    audit: new AuditLedger(join(racine, 'audit.jsonl')),
  };
}

describe('demande (I-36)', () => {
  it('refuse une demande sans tenant', () => {
    expect(() => demande({ tenantId: '  ' })).toThrowError(RequestInvalidError);
  });

  it('refuse une demande sans acteur', () => {
    expect(() => demande({ actor: '' })).toThrowError(RequestInvalidError);
  });

  it('refuse une demande sans texte', () => {
    expect(() => demande({ text: '   ' })).toThrowError(RequestInvalidError);
  });

  it('caviarde le texte dès la construction', () => {
    const token = `${'gh'}${'p_'}${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
    const requete = demande({ text: `pousse avec ${token}` });
    expect(requete.text).not.toContain(token);
    expect(requete.text).toContain('REDACTED');
  });

  it('expose ses signaux structurés', () => {
    const requete = demande({ hints: { action: ' fix ', scope: ' module facturation ' } });
    expect(requete.hint('action')).toBe('fix');
    expect(requete.hint('scope')).toBe('module facturation');
    expect(requete.hint('absent')).toBeUndefined();
  });
});

describe('intention (I-34)', () => {
  it('un signal explicite fixe la catégorie avec une confiance pleine', () => {
    const intention = analyzeSignals(demande({ hints: { action: 'fix' } }));
    expect(intention.category).toBe(IntentCategory.Fix);
    expect(intention.confidence).toBe(1);
    expect(intention.isDetermined).toBe(true);
  });

  it('sans signal, l’intention reste indéterminée et une question est posée', () => {
    const intention = analyzeSignals(demande());
    expect(intention.category).toBe(IntentCategory.Unknown);
    expect(intention.confidence).toBe(0);
    expect(intention.isDetermined).toBe(false);
    expect(intention.openQuestions).toContain(QUESTION_SANS_SIGNAL);
  });

  it('le texte libre ne suffit jamais à déterminer l’intention', () => {
    const intention = analyzeSignals(demande({ text: 'corrige le bug de facturation' }));
    expect(intention.isDetermined).toBe(false);
  });

  it('les neuf catégories sont déclarées', () => {
    expect([...INTENT_CATEGORIES]).toHaveLength(9);
    expect(INTENT_CATEGORIES).toContain(IntentCategory.Unknown);
  });

  it('refuse une confiance hors bornes', () => {
    expect(
      () =>
        new IntentRecord({
          statement: 'x',
          category: IntentCategory.Fix,
          confidence: 1.5,
        }),
    ).toThrowError(RangeError);
  });

  it('est conforme au contrat `intent`', () => {
    const intention = analyzeSignals(demande({ hints: { action: 'deploy', scope: 'prod' } }));
    expect(intention.category).toBe(IntentCategory.Deploy);
    expect(intention.constraints).toContain('périmètre : prod');
  });
});

describe('classification assistée par LLM — le cœur valide', () => {
  it('accepte une classification conforme et plafonne la confiance', async () => {
    const llm = new MockLLMProvider({
      steps: [{ structured: { category: 'FIX', confidence: 0.99, statement: 'corriger' } }],
    });
    const intention = await classifyWithLLM(demande(), llm);
    expect(intention.category).toBe(IntentCategory.Fix);
    expect(intention.confidence).toBe(MAX_INFERRED_CONFIDENCE);
    expect(intention.sources.some((source) => source.startsWith('llm:mock/'))).toBe(true);
  });

  it('refuse une catégorie hors vocabulaire', async () => {
    const llm = new MockLLMProvider({
      steps: [{ structured: { category: 'SUPPRIMER_TOUT', confidence: 1 } }],
    });
    const intention = await classifyWithLLM(demande(), llm);
    expect(intention.isDetermined).toBe(false);
    expect(intention.sources.some((source) => source.includes('hors-vocabulaire'))).toBe(true);
  });

  it('refuse une confiance non numérique', async () => {
    const llm = new MockLLMProvider({
      steps: [{ structured: { category: 'FIX', confidence: 'certaine' } }],
    });
    expect((await classifyWithLLM(demande(), llm)).isDetermined).toBe(false);
  });

  it('refuse une sortie illisible', async () => {
    const llm = new MockLLMProvider({ steps: [{ text: 'je pense que…' }] });
    expect((await classifyWithLLM(demande(), llm)).isDetermined).toBe(false);
  });

  it('un modèle qui répond UNKNOWN laisse la demande indéterminée', async () => {
    const llm = new MockLLMProvider({
      steps: [{ structured: { category: 'UNKNOWN', confidence: 0.4 } }],
    });
    expect((await classifyWithLLM(demande(), llm)).isDetermined).toBe(false);
  });
});

describe('cycle agentique (I-35)', () => {
  it('intention indéterminée : question ouverte, aucune tâche, aucun plan', async () => {
    const { evidence, audit } = journaux();
    const core = new AgentCore({ evidence, audit });
    const resultat = await core.run(demande());

    expect(resultat.status).toBe(OperationStatus.WaitingForUser);
    expect(resultat.question).toBe(QUESTION_SANS_SIGNAL);
    expect(resultat.plan).toBeNull();
    expect(resultat.task).toBeNull();
    expect(resultat.decisionId).toBeNull();
    // Le cycle a bien été consigné, et rien n'a été présenté comme exécuté.
    expect(await evidence.count()).toBe(1);
    expect((await evidence.verify()).ok).toBe(true);
    expect((await audit.verify()).ok).toBe(true);
  });

  it('cycle nominal : plan proposé, tâche PROPOSED, statut NOT_EXECUTED', async () => {
    const { evidence, audit } = journaux();
    const core = new AgentCore({ evidence, audit });
    const resultat = await core.run(demande({ hints: { action: 'fix' } }), {
      steps: etapesValides(),
    });

    expect(resultat.status).toBe(OperationStatus.NotExecuted);
    expect(resultat.plan?.status).toBe('PROPOSED');
    expect(resultat.task?.state).toBe(TaskState.Proposed);
    expect(resultat.notes).toContain(EXECUTION_BOUNDARY);
    expect(resultat.intent.category).toBe(IntentCategory.Fix);
    expect((await evidence.verify()).ok).toBe(true);
  });

  it('le cycle ne revendique jamais une exécution (I-35)', async () => {
    const core = new AgentCore();
    const resultat = await core.run(demande({ hints: { action: 'test' } }), {
      steps: etapesValides(),
    });
    expect(resultat.status).not.toBe(OperationStatus.Executed);
    expect(resultat.status).not.toBe(OperationStatus.Verified);
    expect(resultat.task?.history.some((event) => event.toState === TaskState.Verified)).toBe(
      false,
    );
  });

  it('un refus de politique bloque et n’engage aucune tâche', async () => {
    const core = new AgentCore();
    const resultat = await core.run(demande({ hints: { action: 'deploy' } }), {
      steps: etapesValides(),
      policy: PolicyVerdict.deny({ policyId: 'politique-test', reason: 'déploiement interdit' }),
    });
    expect(resultat.status).toBe(OperationStatus.Blocked);
    expect(resultat.decisionId).not.toBeNull();
    expect(resultat.task).toBeNull();
    expect(resultat.notes.some((note) => note.includes('aucune tâche'))).toBe(true);
  });

  it('une obligation de Human Gate met la tâche en attente', async () => {
    const core = new AgentCore();
    const resultat = await core.run(demande({ hints: { action: 'deploy' } }), {
      steps: etapesValides(),
      options: [
        option('déployer en production', {
          riskClass: RiskClass.Deployment,
          reversible: false,
        }),
      ],
      policy: PolicyVerdict.requireApproval({
        policyId: 'politique-test',
        reason: 'action engageante',
      }),
      verificationPlan: ['santé du service après déploiement'],
    });
    expect(resultat.status).toBe(OperationStatus.WaitingForUser);
    expect(resultat.task?.state).toBe(TaskState.WaitingForUser);
    expect(resultat.notes.some((note) => note.includes('approbation'))).toBe(true);
  });

  it('la tâche et le plan portent le tenant de la demande', async () => {
    const core = new AgentCore();
    const resultat = await core.run(demande({ tenantId: 'tenant-b', hints: { action: 'fix' } }), {
      steps: etapesValides(),
    });
    expect(resultat.tenantId).toBe('tenant-b');
    expect(resultat.plan?.tenantId).toBe('tenant-b');
    expect(resultat.task?.tenantId).toBe('tenant-b');
  });
});

describe('le LLM n’a aucune autorité sur le plan', () => {
  it('des étapes proposées sans critère de vérification sont refusées', async () => {
    const llm = new MockLLMProvider({
      steps: [
        { structured: { category: 'FIX', confidence: 0.8 } },
        {
          structured: {
            steps: [{ description: 'tout réécrire', expected_output: 'mieux', verification: [] }],
          },
        },
      ],
    });
    const core = new AgentCore({ llm });
    await expect(core.run(demande(), { useLlmForPlan: true })).rejects.toThrowError(
      PlanInvalidError,
    );
  });

  it('une étape destructive proposée sans rollback est refusée', async () => {
    const llm = new MockLLMProvider({
      steps: [
        { structured: { category: 'FIX', confidence: 0.8 } },
        {
          structured: {
            steps: [
              {
                description: 'supprimer la table',
                expected_output: 'table supprimée',
                verification: ['la table est absente'],
                risk_class: 'DESTRUCTIVE',
              },
            ],
          },
        },
      ],
    });
    const core = new AgentCore({ llm });
    await expect(core.run(demande(), { useLlmForPlan: true })).rejects.toThrowError(
      PlanInvalidError,
    );
  });

  it('des étapes valides proposées par le modèle sont acceptées après validation', async () => {
    const llm = new MockLLMProvider({
      steps: [
        { structured: { category: 'FIX', confidence: 0.8 } },
        {
          structured: {
            steps: [
              {
                description: 'corriger la validation d’entrée',
                expected_output: 'entrée invalide refusée',
                verification: ['test unitaire en échec avant, vert après'],
              },
            ],
          },
        },
      ],
    });
    const core = new AgentCore({ llm });
    const resultat = await core.run(demande(), { useLlmForPlan: true });
    expect(resultat.intent.category).toBe(IntentCategory.Fix);
    expect(resultat.plan?.steps).toHaveLength(1);
    expect(resultat.status).toBe(OperationStatus.NotExecuted);
    expect(resultat.notes.some((note) => note.includes('validées par les invariants'))).toBe(true);
  });

  it('un fournisseur en panne laisse la demande indéterminée plutôt que de planter', async () => {
    const llm = new MockLLMProvider({ steps: [{ error: 'fournisseur indisponible' }] });
    const core = new AgentCore({ llm });
    const resultat = await core.run(demande());
    expect(resultat.status).toBe(OperationStatus.WaitingForUser);
    expect(resultat.question).toBe(QUESTION_SANS_SIGNAL);
    expect(resultat.task).toBeNull();
  });

  it('aucun provider configuré : les étapes ne sont pas proposables', async () => {
    const core = new AgentCore();
    await expect(core.proposeSteps('objectif', await core.analyze(demande()))).rejects.toThrowError(
      PlanInvalidError,
    );
  });
});
