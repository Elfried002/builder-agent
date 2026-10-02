/**
 * Tests d'intégration : cycle complet, isolation, secrets, et **parité croisée** avec Python.
 *
 * Le dernier bloc est le plus important : un journal produit par le Core TypeScript est relu par
 * l'implémentation Python, qui recalcule chaque hachage. Si les deux implémentations ne
 * produisaient pas les mêmes octets, ce test échouerait — et la « preuve » ne serait valable que
 * pour l'implémentation qui l'a produite.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUDIT_FILENAME,
  CodiDevCore,
  EVIDENCE_FILENAME,
  OperationStatus,
  TaskState,
} from '../src/index.js';
import type { MockStep } from '../src/llm/index.js';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PYTHON = join(process.env.HOME ?? '', '.local/share/codidev/venv/bin/python');
const VERIFIER = join(REPO_ROOT, 'scripts', 'verify_journal_python.py');

/** Clé factice : jamais réelle, jamais valide. */
function fakeToken(): string {
  return `${'gh'}${'p_'}${'Z1y2X3w4V5u6T7s8R9q0P1o2N3m4L5k6J7i8'}`;
}

/** Scénario : classer la demande, puis proposer des étapes vérifiables. */
function scenario(): MockStep[] {
  return [
    {
      structured: {
        category: 'MODIFY_SOFTWARE',
        confidence: 0.9,
        statement: 'durcir la validation',
      },
    },
    {
      structured: {
        steps: [
          {
            description: 'ajouter la validation d’entrée',
            expected_output: 'entrée invalide refusée',
            verification: ['test unitaire rouge avant, vert après'],
          },
          {
            description: 'documenter la règle',
            expected_output: 'règle documentée',
            verification: ['section présente dans le README'],
          },
        ],
      },
    },
  ];
}

function nouveauCore(racine: string, steps: MockStep[] = scenario()): CodiDevCore {
  return CodiDevCore.create({
    workspaceDir: mkdtempSync(join(racine, 'run-')),
    env: {},
    llm: {
      provider: 'mock',
      model: 'mock-model',
      apiKeyEnvVar: 'CODIDEV_DEEPSEEK_API_KEY',
      baseUrl: 'https://exemple.invalid',
      timeoutMs: 1000,
      maxRetries: 0,
      maxTokens: 1024,
      temperature: 0,
    },
    mockSteps: steps,
  });
}

describe('cycle complet de bout en bout', () => {
  it('demande sans signal → classification par le modèle → plan validé → tâche PROPOSED', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-e2e-'));
    const core = nouveauCore(racine);

    const resultat = await core.run(
      { text: 'durcir la validation des entrées', tenantId: 'tenant-a', actor: 'user-1' },
      { useLlmForPlan: true },
    );

    expect(resultat.status).toBe(OperationStatus.NotExecuted);
    expect(resultat.intent.category).toBe('MODIFY_SOFTWARE');
    expect(resultat.intent.sources.some((source) => source.startsWith('llm:mock/'))).toBe(true);
    expect(resultat.plan?.status).toBe('PROPOSED');
    expect(resultat.plan?.steps).toHaveLength(2);
    expect(resultat.task?.state).toBe(TaskState.Proposed);

    const integrite = await core.integrity();
    expect(integrite.evidence.ok).toBe(true);
    expect(integrite.audit.ok).toBe(true);
    expect(integrite.evidence.count).toBeGreaterThan(0);
    expect(integrite.audit.count).toBeGreaterThan(0);
  });

  it('aucune preuve ne porte un statut de réussite non mérité', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-e2e2-'));
    const core = nouveauCore(racine);
    await core.run(
      { text: 'durcir la validation', tenantId: 'tenant-a', actor: 'user-1' },
      { useLlmForPlan: true },
    );
    const preuves = readFileSync(join(core.workspaceDir, EVIDENCE_FILENAME), 'utf8');
    // Le cycle ne peut produire ni EXECUTED ni VERIFIED : il n'exécute rien.
    expect(preuves).not.toContain('"status":"VERIFIED"');
    expect(preuves).not.toContain('"status":"EXECUTED"');
    expect(preuves).toContain('"status":"NOT_EXECUTED"');
  });

  it('isole deux tenants, y compris dans les journaux', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-iso-'));
    const coreA = nouveauCore(racine);
    const coreB = nouveauCore(racine);

    await coreA.run(
      { text: 'travail de A', tenantId: 'tenant-a', actor: 'user-a' },
      { useLlmForPlan: true },
    );
    await coreB.run(
      { text: 'travail de B', tenantId: 'tenant-b', actor: 'user-b' },
      { useLlmForPlan: true },
    );

    const preuvesA = readFileSync(join(coreA.workspaceDir, EVIDENCE_FILENAME), 'utf8');
    const preuvesB = readFileSync(join(coreB.workspaceDir, EVIDENCE_FILENAME), 'utf8');
    expect(preuvesA).toContain('tenant-a');
    expect(preuvesA).not.toContain('tenant-b');
    expect(preuvesB).toContain('tenant-b');
    expect(preuvesB).not.toContain('tenant-a');
  });

  it('aucun secret n’atteint les journaux, même fourni dans la demande', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-secret-'));
    // Intention explicite : le modèle n'est sollicité que pour proposer le plan.
    const core = nouveauCore(racine, [
      {
        structured: {
          steps: [
            {
              description: 'vérifier l’état avant déploiement',
              expected_output: 'état connu',
              verification: ['santé du service relevée'],
            },
          ],
        },
      },
    ]);
    const token = fakeToken();

    const resultat = await core.run(
      {
        text: `déployer avec ${token}`,
        tenantId: 'tenant-a',
        actor: 'user-1',
        hints: { action: 'deploy' },
      },
      { useLlmForPlan: true },
    );

    // Le texte est caviardé dès la construction de la demande : l'intention, qui le porte, ne
    // contient plus la valeur.
    expect(resultat.intent.statement).not.toContain(token);
    expect(resultat.intent.statement).toContain('REDACTED');

    // Les journaux ne contiennent la valeur nulle part — ni dans un champ, ni dans un hachage
    // calculé sur un contenu non caviardé.
    const preuves = readFileSync(join(core.workspaceDir, EVIDENCE_FILENAME), 'utf8');
    const audit = readFileSync(join(core.workspaceDir, AUDIT_FILENAME), 'utf8');
    expect(preuves).not.toContain(token);
    expect(audit).not.toContain(token);

    // Le caviardage a lieu AVANT le calcul du hachage : la chaîne reste donc intègre.
    expect((await core.integrity()).evidence.ok).toBe(true);
    expect((await core.integrity()).audit.ok).toBe(true);
  });

  it('refuse un plan proposé qui viole les invariants, sans rien consigner comme exécuté', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-refus-'));
    const core = nouveauCore(racine, [
      { structured: { category: 'DEPLOY', confidence: 0.8 } },
      {
        structured: {
          steps: [{ description: 'déployer', expected_output: 'en ligne', verification: [] }],
        },
      },
    ]);

    await expect(
      core.run(
        { text: 'mettre en ligne', tenantId: 'tenant-a', actor: 'user-1' },
        { useLlmForPlan: true },
      ),
    ).rejects.toThrowError(/vérification/);
    const integrite = await core.integrity();
    expect(integrite.evidence.count).toBe(0);
    expect(integrite.audit.count).toBeGreaterThanOrEqual(1);
    expect(integrite.audit.ok).toBe(true);
  });
});

describe('parité croisée : le journal TypeScript relu par Python', () => {
  it('Python recalcule les mêmes hachages que le Core TypeScript', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-parite-'));
    const core = nouveauCore(racine);
    await core.run(
      {
        text: 'parité des journaux entre implémentations',
        tenantId: 'tenant-parite',
        actor: 'user-1',
      },
      { useLlmForPlan: true },
    );

    for (const fichier of [EVIDENCE_FILENAME, AUDIT_FILENAME]) {
      const chemin = join(core.workspaceDir, fichier);
      let sortie: string;
      try {
        sortie = execFileSync(PYTHON, [VERIFIER, chemin], { encoding: 'utf8' });
      } catch (error) {
        const echec = error as { stdout?: string; stderr?: string };
        throw new Error(
          `l'implémentation Python n'a pas reconnu le journal ${fichier} : ${echec.stdout ?? ''} ${echec.stderr ?? ''}`,
        );
      }
      const rapport = JSON.parse(sortie) as { ok: boolean; count: number; issues: unknown[] };
      expect(rapport.issues).toEqual([]);
      expect(rapport.ok).toBe(true);
      expect(rapport.count).toBeGreaterThan(0);
    }
  });
});
