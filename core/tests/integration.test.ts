/**
 * Tests d'intégration : cycle complet, isolation, secrets, et **parité croisée**.
 *
 * Le dernier bloc est le plus important. La parité des preuves ne se démontre pas en comparant du
 * code : elle se démontre en relisant, avec une implémentation, un journal écrit par une autre. Les
 * journaux de référence ont été **produits par l'implémentation Python** puis figés dans
 * `tests/fixtures/` — c'est ce qui permet de retirer cette implémentation sans perdre la garantie
 * que les preuves restent mutuellement vérifiables.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUDIT_FILENAME,
  AuditLedger,
  CodiDevCore,
  EVIDENCE_FILENAME,
  EvidenceStore,
  OperationStatus,
  TaskState,
} from '../src/index.js';
import type { MockStep } from '../src/llm/index.js';
import { step } from '../src/planner/planner.js';

const CORE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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
    const enregistrements = preuves
      .split('\n')
      .filter((ligne) => ligne.trim() !== '')
      .map((ligne) => JSON.parse(ligne) as { operation: string; status: string });

    // Rien n'a été vérifié : aucun enregistrement ne peut porter VERIFIED.
    expect(enregistrements.some((item) => item.status === 'VERIFIED')).toBe(false);

    // Le compte rendu du cycle déclare explicitement qu'aucune exécution n'a eu lieu.
    const cycle = enregistrements.filter((item) => item.operation === 'core.run');
    expect(cycle).toHaveLength(1);
    expect(cycle[0]?.status).toBe('NOT_EXECUTED');

    // Les seules opérations consignées `EXECUTED` sont des transitions de tâche — c'est-à-dire des
    // opérations qui ont réellement eu lieu (ouvrir une tâche, la faire changer d'état), et non le
    // travail demandé. La distinction est portée par le nom de l'opération, pas par une nuance.
    for (const item of enregistrements) {
      if (item.status === 'EXECUTED') {
        expect(item.operation.startsWith('task.')).toBe(true);
      } else {
        expect(item.operation).toBe('core.run');
        expect(item.status).toBe('NOT_EXECUTED');
      }
    }
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

describe('les transitions de tâche sont journalisées en preuve et en audit (I-14)', () => {
  it('chaque transition apparaît dans les deux journaux', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'codidev-i14-'));
    const core = nouveauCore(racine);
    await core.run(
      {
        text: 'travail journalisé',
        tenantId: 'tenant-a',
        actor: 'user-1',
        hints: { action: 'fix' },
      },
      {
        steps: [
          step('étape unique', { expectedOutput: 'résultat', verification: ['critère observé'] }),
        ],
      },
    );

    const preuves = readFileSync(join(core.workspaceDir, EVIDENCE_FILENAME), 'utf8');
    const audit = readFileSync(join(core.workspaceDir, AUDIT_FILENAME), 'utf8');

    // Sans branchement des journaux dans le Task Engine, ces lignes n'existeraient pas : la tâche
    // ne les conserverait que dans son propre historique, et l'invariant ne serait tenu qu'à moitié.
    for (const attendu of [
      'task.open:DRAFT',
      'task.transition:DRAFT->ANALYZING',
      'task.transition:ANALYZING->PROPOSED',
    ]) {
      expect(preuves).toContain(attendu);
      expect(audit).toContain(attendu);
    }
    expect((await core.integrity()).evidence.ok).toBe(true);
    expect((await core.integrity()).audit.ok).toBe(true);
  });
});

describe('parité croisée : un journal écrit par Python relu par le TypeScript', () => {
  const FIXTURES = join(CORE_ROOT, 'tests', 'fixtures');

  /**
   * Ces journaux ont été **écrits par l'implémentation Python** du cœur, puis figés ici.
   *
   * Le test qui les utilisait invoquait l'interpréteur Python ; il relit désormais un artefact figé.
   * C'est ce qui permet de retirer l'implémentation Python sans perdre la garantie : les preuves
   * doivent rester vérifiables par l'implémentation qui, elle, existe toujours.
   */
  it('reconnaît intègre un journal produit par l’implémentation Python', async () => {
    for (const [fichier, contrat] of [
      ['evidence-python.jsonl', 'evidence'],
      ['audit-python.jsonl', 'audit_record'],
    ] as const) {
      const journal =
        contrat === 'evidence'
          ? new EvidenceStore(join(FIXTURES, fichier))
          : new AuditLedger(join(FIXTURES, fichier));
      const rapport = await journal.verify();
      expect(rapport.issues).toEqual([]);
      expect(rapport.ok).toBe(true);
      expect(rapport.count).toBeGreaterThan(0);
      expect(rapport.contract).toBe(contrat);
    }
  });

  it('le journal figé ne contient aucun secret en clair et porte la marque de caviardage', () => {
    const contenu = readFileSync(join(FIXTURES, 'evidence-python.jsonl'), 'utf8');
    // Le jeton factice fourni à l'implémentation Python a été neutralisé à l'écriture : c'est la
    // garantie (I-29) que la suppression du Python ne doit pas emporter avec elle.
    expect(contenu).toContain('REDACTED');
    expect(contenu).not.toContain(`${'gh'}${'p_'}`);
  });

  it('une altération du journal figé serait détectée', async () => {
    // Sans ce contrôle, un test qui se contente de « lire sans erreur » passerait aussi sur un
    // fichier vide, ou sur un journal dont la vérification ne vérifie rien.
    const racine = mkdtempSync(join(tmpdir(), 'codidev-altere-'));
    const copie = join(racine, 'evidence-python.jsonl');
    const lignes = readFileSync(join(FIXTURES, 'evidence-python.jsonl'), 'utf8')
      .split('\n')
      .filter((ligne) => ligne.trim() !== '');
    const premier = JSON.parse(lignes[0] ?? '{}') as Record<string, unknown>;
    premier.status = 'VERIFIED';
    lignes[0] = JSON.stringify(premier);
    writeFileSync(copie, `${lignes.join('\n')}\n`, 'utf8');

    const rapport = await new EvidenceStore(copie).verify();
    expect(rapport.ok).toBe(false);
    expect(rapport.issues.some((issue) => issue.code === 'HASH_MISMATCH')).toBe(true);
  });
});
